"use strict";

const { transitionMathState } = require("../../../../math-map/transition/math-state-transition-v1/src/index.js");
const { transitionRouteState } = require("../../../../math-route/transition/route-state-transition-v2/src/index.js");
const { createHash } = require("node:crypto");

const CAPABILITY_ID = "cmath.research-draft-lifecycle/v1";
const DRAFT_GRAPH_SCHEMA = "cmath.research-draft-graph/v1";
const WORKING_VIEW_SCHEMA = "cmath.research-working-view/v1";
const PIN_FIELDS = ["state_id", "snapshot_id", "revision"];
const ACTION_RESULT_FIELDS = new Set([
  "action_id",
  "action_type",
  "result_kind",
  "narrative",
  "evidence_refs",
  "accepted_refs",
  "draft_refs",
  "dependencies",
  "effect",
  "route_effect",
]);
const PREPARED_FIELDS = new Set(["capability", "base", "selection", "draft_ids", "delta_m", "delta_r", "provenance", "compilation_id"]);
const RECEIPT_FIELDS = new Set(["receipt_id", "status", "base", "selection", "compilation_id"]);
const MATH_REF_KINDS = new Set(["entry", "inference"]);
const SUCCESS_RECEIPT_STATUSES = new Set(["success"]);
const FAILED_RECEIPT_STATUSES = new Set(["failed"]);
const DEFAULT_DELTA_R = Object.freeze({
  route: Object.freeze({ operation: "keep" }),
  selection: Object.freeze({ operation: "keep_current" }),
});
const ROUTE_EFFECT_FIELDS = new Set(["route_delta", "selection_delta"]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function clone(value, label, code = "INVALID_DRAFT_REQUEST") {
  try {
    return structuredClone(value);
  } catch {
    fail(code, `${label} must be structured-cloneable`);
  }
}

function assertJsonCompatible(value, label, code) {
  const seen = new Set();

  function visit(current, path) {
    if (current === null || typeof current === "string" || typeof current === "boolean") return;
    if (typeof current === "number" && Number.isFinite(current)) return;
    if (typeof current !== "object") {
      fail(code, `${path} must contain only JSON-compatible plain data`);
    }
    if (seen.has(current)) fail(code, `${path} must not contain cyclic structures`);
    seen.add(current);
    try {
      if (Array.isArray(current)) {
        for (const key of Reflect.ownKeys(current)) {
          if (key === "length") continue;
          if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= 4294967295) {
            fail(code, `${path} must contain only JSON-compatible array values`);
          }
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (!descriptor || !own(descriptor, "value") || !descriptor.enumerable) {
            fail(code, `${path} must contain only JSON-compatible array values`);
          }
        }
        for (let index = 0; index < current.length; index += 1) {
          if (!own(current, index)) fail(code, `${path}[${index}] must not be undefined`);
          visit(current[index], `${path}[${index}]`);
        }
        return;
      }
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        fail(code, `${path} must be a plain object`);
      }
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key !== "string") fail(code, `${path} must use string object keys`);
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !own(descriptor, "value") || !descriptor.enumerable) {
          fail(code, `${path}.${String(key)} must be a JSON-compatible data property`);
        }
        visit(descriptor.value, `${path}.${key}`);
      }
    } finally {
      seen.delete(current);
    }
  }

  visit(value, label);
}

function exactString(value, label, code = "INVALID_DRAFT_REQUEST") {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(code, `${label} must be a non-empty exact string`);
  }
  return value;
}

function closed(value, allowed, label, code = "INVALID_DRAFT_REQUEST") {
  if (!plain(value)) fail(code, `${label} must be an object`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      fail(code, `${label} contains unknown field: ${String(key)}`, { field: key });
    }
  }
}

function pinFromSnapshot(snapshot) {
  return {
    state_id: exactString(snapshot.state_id, "snapshot.state_id", "INVALID_SNAPSHOT"),
    snapshot_id: exactString(snapshot.snapshot_id, "snapshot.snapshot_id", "INVALID_SNAPSHOT"),
    revision: snapshot.revision,
  };
}

function samePin(left, right) {
  return plain(left) && plain(right) && PIN_FIELDS.every((field) => left[field] === right[field]);
}

function validateSnapshot(snapshot) {
  closed(snapshot, new Set(["state_id", "snapshot_id", "revision", "M", "R"]), "snapshot", "INVALID_SNAPSHOT");
  const pin = pinFromSnapshot(snapshot);
  if (!Number.isSafeInteger(pin.revision) || pin.revision < 0) {
    fail("INVALID_SNAPSHOT", "snapshot.revision must be a non-negative safe integer");
  }
  if (!plain(snapshot.M)) fail("INVALID_SNAPSHOT", "snapshot.M must be an object");
  if (!plain(snapshot.R)) fail("INVALID_SNAPSHOT", "snapshot.R must be an object");
  const math = transitionMathState(snapshot.M, { operation: "no_change" });
  transitionRouteState(snapshot.M, snapshot.R, { operation: "keep" }, { operation: "keep_current" });
  return { pin, M: math.next_m, R: clone(snapshot.R, "snapshot.R", "INVALID_SNAPSHOT") };
}

function validateRef(value, M, label, code = "INVALID_ACTION_RESULT") {
  closed(value, new Set(["kind", "id"]), label, code);
  if (!MATH_REF_KINDS.has(value.kind)) fail(code, `${label}.kind must be entry or inference`);
  const id = exactString(value.id, `${label}.id`, code);
  const exists = value.kind === "entry"
    ? M.entries.some((entry) => entry.id === id)
    : M.inferences.some((inference) => inference.id === id);
  if (!exists) fail("UNKNOWN_ACCEPTED_REFERENCE", `${label} references unknown accepted object: ${id}`, { id });
  return { kind: value.kind, id };
}

function refs(value, M, label, code = "INVALID_ACTION_RESULT") {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  const seen = new Set();
  return value.map((item, index) => {
    const ref = validateRef(item, M, `${label}[${index}]`, code);
    const key = `${ref.kind}:${ref.id}`;
    if (seen.has(key)) fail(code, `${label} contains duplicate reference: ${key}`);
    seen.add(key);
    return ref;
  });
}

function draftRefs(value, label, code = "INVALID_ACTION_RESULT") {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  const seen = new Set();
  return value.map((item, index) => {
    closed(item, new Set(["kind", "id"]), `${label}[${index}]`, code);
    if (!MATH_REF_KINDS.has(item.kind)) fail(code, `${label}[${index}].kind must be entry or inference`);
    const id = exactString(item.id, `${label}[${index}].id`, code);
    const key = `${item.kind}:${id}`;
    if (seen.has(key)) fail(code, `${label} contains duplicate reference: ${key}`);
    seen.add(key);
    return { kind: item.kind, id };
  });
}

function dependencies(value, label, code = "INVALID_ACTION_RESULT") {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  const seen = new Set();
  return value.map((id, index) => {
    exactString(id, `${label}[${index}]`, code);
    if (seen.has(id)) fail(code, `${label} contains duplicate dependency: ${id}`);
    seen.add(id);
    return id;
  });
}

function validateRouteEffect(value, label = "action_result.route_effect", code = "INVALID_ACTION_RESULT") {
  if (!plain(value)) fail(code, `${label} must be an object`);
  closed(value, ROUTE_EFFECT_FIELDS, label, code);
  for (const field of ROUTE_EFFECT_FIELDS) {
    if (!own(value, field)) fail(code, `${label} is missing field: ${field}`);
  }
  return {
    route_delta: clone(value.route_delta, `${label}.route_delta`, code),
    selection_delta: clone(value.selection_delta, `${label}.selection_delta`, code),
  };
}

function validateEffect(effect) {
  if (!plain(effect)) fail("INVALID_ACTION_RESULT", "Action Result effect must be an object");
  if (effect.operation === "no_change") {
    closed(effect, new Set(["operation"]), "no_change Action Result effect", "INVALID_ACTION_RESULT");
    return { operation: "no_change" };
  }
  if (effect.operation === "add_entry") {
    closed(effect, new Set(["operation", "entry"]), "add_entry Action Result effect", "INVALID_ACTION_RESULT");
    if (!plain(effect.entry)) fail("INVALID_ACTION_RESULT", "add_entry effect.entry must be an object");
    exactString(effect.entry.id, "add_entry effect.entry.id", "INVALID_ACTION_RESULT");
    return { operation: "add_entry", entry: clone(effect.entry, "effect.entry", "INVALID_ACTION_RESULT") };
  }
  if (effect.operation === "add_inference") {
    closed(effect, new Set(["operation", "inference"]), "add_inference Action Result effect", "INVALID_ACTION_RESULT");
    if (!plain(effect.inference)) fail("INVALID_ACTION_RESULT", "add_inference effect.inference must be an object");
    exactString(effect.inference.id, "add_inference effect.inference.id", "INVALID_ACTION_RESULT");
    return { operation: "add_inference", inference: clone(effect.inference, "effect.inference", "INVALID_ACTION_RESULT") };
  }
  if (effect.operation === "add_negation_pair") {
    closed(effect, new Set(["operation", "negation_pair"]), "add_negation_pair Action Result effect", "INVALID_ACTION_RESULT");
    if (!plain(effect.negation_pair)) fail("INVALID_ACTION_RESULT", "add_negation_pair effect.negation_pair must be an object");
    return { operation: "add_negation_pair", negation_pair: clone(effect.negation_pair, "effect.negation_pair", "INVALID_ACTION_RESULT") };
  }
  if (effect.operation === "add_b0_claim") {
    closed(effect, new Set(["operation", "claim_entry_id"]), "add_b0_claim Action Result effect", "INVALID_ACTION_RESULT");
    if (typeof effect.claim_entry_id !== "string") fail("INVALID_ACTION_RESULT", "add_b0_claim effect.claim_entry_id must be a string");
    return { operation: "add_b0_claim", claim_entry_id: effect.claim_entry_id };
  }
  fail("UNSUPPORTED_ACTION_RESULT", `Unsupported math effect operation: ${effect.operation}`);
}

function validateEffects(value) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) {
    fail("INVALID_ACTION_RESULT", "Action Result effect array must not be empty");
  }
  const normalized = values.map(validateEffect);
  if (normalized.length > 1 && normalized.some((effect) => effect.operation === "no_change")) {
    fail("INVALID_ACTION_RESULT", "no_change cannot be combined with mathematical effects");
  }
  return Array.isArray(value) ? normalized : normalized[0];
}

function effectsOf(effect) {
  return Array.isArray(effect) ? effect : [effect];
}

function hasMathEffect(effect) {
  return effectsOf(effect).some((item) => item.operation !== "no_change");
}

function validateActionResult(actionResult, M) {
  assertJsonCompatible(actionResult, "action_result", "INVALID_ACTION_RESULT");
  if (!plain(actionResult)) fail("INVALID_ACTION_RESULT", "Action Result must be an object");
  closed(actionResult, ACTION_RESULT_FIELDS, "action_result", "INVALID_ACTION_RESULT");
  const actionId = exactString(actionResult.action_id, "action_result.action_id", "INVALID_ACTION_RESULT");
  exactString(actionResult.action_type, "action_result.action_type", "INVALID_ACTION_RESULT");
  const resultKind = exactString(actionResult.result_kind, "action_result.result_kind", "INVALID_ACTION_RESULT");
  const supportedResultKinds = new Set(["math", "mathematical", "math-only", "route", "mixed", "no_change"]);
  if (!supportedResultKinds.has(resultKind)) {
    fail("UNSUPPORTED_ACTION_RESULT", `Unsupported Action Result kind: ${resultKind}`);
  }
  const acceptedRefs = refs(actionResult.accepted_refs, M, "action_result.accepted_refs");
  const draftRefsValue = draftRefs(actionResult.draft_refs, "action_result.draft_refs");
  const dependenciesValue = dependencies(actionResult.dependencies, "action_result.dependencies");
  if (own(actionResult, "evidence_refs") && !Array.isArray(actionResult.evidence_refs)) {
    fail("INVALID_ACTION_RESULT", "action_result.evidence_refs must be an array");
  }
  if (!own(actionResult, "effect")) fail("INVALID_ACTION_RESULT", "Action Result must explicitly contain one effect");
  const effect = validateEffects(actionResult.effect);
  const routeEffect = own(actionResult, "route_effect")
    ? validateRouteEffect(actionResult.route_effect)
    : undefined;
  if (resultKind === "route") {
    if (hasMathEffect(effect)) {
      fail("INVALID_ACTION_RESULT", "route Action Result must use a no_change math effect");
    }
    if (routeEffect === undefined) fail("INVALID_ACTION_RESULT", "route Action Result must contain route_effect");
  } else if (resultKind === "mixed") {
    if (!hasMathEffect(effect)) {
      fail("INVALID_ACTION_RESULT", "mixed Action Result must contain a math effect");
    }
    if (routeEffect === undefined) fail("INVALID_ACTION_RESULT", "mixed Action Result must contain route_effect");
  } else if (resultKind === "no_change") {
    if (hasMathEffect(effect)) {
      fail("INVALID_ACTION_RESULT", "no_change Action Result must use a no_change math effect");
    }
    if (routeEffect !== undefined) fail("INVALID_ACTION_RESULT", "no_change Action Result cannot contain route_effect");
  } else if (routeEffect !== undefined) {
    fail("INVALID_ACTION_RESULT", "math Action Results must use result_kind mixed for route_effect");
  }
  return {
    actionId,
    acceptedRefs,
    draftRefs: draftRefsValue,
    dependencies: dependenciesValue,
    effect,
    routeEffect,
  };
}

function effectObjects(effect) {
  return effectsOf(effect).flatMap((item) => {
    if (item.operation === "add_entry" && typeof item.entry?.id === "string") {
      return [{ kind: "entry", id: item.entry.id }];
    }
    if (item.operation === "add_inference" && typeof item.inference?.id === "string") {
      return [{ kind: "inference", id: item.inference.id }];
    }
    return [];
  });
}

function objectKey(value) {
  return `${value.kind}:${value.id}`;
}

function validateDraftRecord(record, M, pin, knownActionIds, historicalPins = []) {
  closed(record, new Set(["draft_id", "status", "action_result", "effect", "route_effect", "accepted_refs", "draft_refs", "dependencies", "lineage", "pending"]), "draft record", "INVALID_DRAFT_GRAPH");
  if (!plain(record.action_result)) fail("INVALID_DRAFT_GRAPH", "draft.action_result must be an object");
  if (!plain(record.effect) && !Array.isArray(record.effect)) fail("INVALID_DRAFT_GRAPH", "draft.effect must be an object or array");
  if (!Array.isArray(record.accepted_refs)) fail("INVALID_DRAFT_GRAPH", "draft.accepted_refs must be an array");
  if (!plain(record.lineage)) fail("INVALID_DRAFT_GRAPH", "draft.lineage must be an object");
  const action = validateActionResult(record.action_result, M);
  const draftId = exactString(record.draft_id, "draft.draft_id", "INVALID_DRAFT_GRAPH");
  if (draftId !== action.actionId) fail("INVALID_DRAFT_GRAPH", "draft_id must match action_result.action_id");
  if (knownActionIds.has(draftId)) fail("DRAFT_CONFLICT", `Duplicate draft action identity: ${draftId}`, { draftId });
  knownActionIds.add(draftId);
  const status = record.status;
  if (status !== "draft" && status !== "admitted") fail("INVALID_DRAFT_GRAPH", "draft.status must be draft or admitted");
  const effect = validateEffects(record.effect);
  if (JSON.stringify(effect) !== JSON.stringify(action.effect)) fail("INVALID_DRAFT_GRAPH", "draft.effect must match action_result effect");
  const routeEffect = own(record, "route_effect")
    ? validateRouteEffect(record.route_effect, "draft.route_effect", "INVALID_DRAFT_GRAPH")
    : undefined;
  if (JSON.stringify(routeEffect) !== JSON.stringify(action.routeEffect)) {
    fail("INVALID_DRAFT_GRAPH", "draft.route_effect must match action_result route_effect");
  }
  const acceptedRefs = refs(record.accepted_refs, M, "draft.accepted_refs", "INVALID_DRAFT_GRAPH");
  if (JSON.stringify(acceptedRefs) !== JSON.stringify(action.acceptedRefs)) fail("INVALID_DRAFT_GRAPH", "draft.accepted_refs must match action_result references");
  const draftRefsValue = draftRefs(record.draft_refs, "draft.draft_refs", "INVALID_DRAFT_GRAPH");
  const dependenciesValue = dependencies(record.dependencies, "draft.dependencies", "INVALID_DRAFT_GRAPH");
  if (JSON.stringify(draftRefsValue) !== JSON.stringify(action.draftRefs)) fail("INVALID_DRAFT_GRAPH", "draft.draft_refs must match action_result references");
  if (JSON.stringify(dependenciesValue) !== JSON.stringify(action.dependencies)) fail("INVALID_DRAFT_GRAPH", "draft.dependencies must match action_result dependencies");
  closed(record.lineage, new Set(["base", "status", "receipt_id", "compilation_id"]), "draft.lineage", "INVALID_DRAFT_GRAPH");
  if (!samePin(record.lineage.base, pin) && !historicalPins.some((base) => samePin(record.lineage.base, base))) fail("STALE_DRAFT_BASE", "draft lineage is bound to a different Snapshot", { expected: pin, actual: record.lineage.base });
  if (record.lineage.status !== status) fail("INVALID_DRAFT_GRAPH", "draft lineage status must match draft status");
  if (status === "draft" && (record.lineage.receipt_id !== null || record.lineage.compilation_id !== null)) {
    fail("INVALID_DRAFT_GRAPH", "draft lineage cannot contain an admission receipt");
  }
  if (status === "admitted") {
    exactString(record.lineage.receipt_id, "draft.lineage.receipt_id", "INVALID_DRAFT_GRAPH");
    exactString(record.lineage.compilation_id, "draft.lineage.compilation_id", "INVALID_DRAFT_GRAPH");
  }
  if (own(record, "pending")) {
    closed(record.pending, new Set(["code", "message"]), "draft.pending", "INVALID_DRAFT_GRAPH");
    exactString(record.pending.code, "draft.pending.code", "INVALID_DRAFT_GRAPH");
    exactString(record.pending.message, "draft.pending.message", "INVALID_DRAFT_GRAPH");
    if (status !== "draft" || historicalPins.length === 0) fail("INVALID_DRAFT_GRAPH", "pending requires a continued draft");
  }
  return { draftId, action, effect, routeEffect, acceptedRefs, draftRefs: draftRefsValue, dependencies: dependenciesValue };
}

function validateDraftRelations(records, code) {
  const byId = new Map(records.map((record) => [record.draftId, record]));
  for (const record of records) {
    const available = new Set();
    for (const dependency of record.dependencies) {
      const dependencyRecord = byId.get(dependency);
      if (!dependencyRecord) {
        fail(code, `${record.draftId} references unknown dependency: ${dependency}`, { draftId: record.draftId, dependency });
      }
      for (const produced of effectObjects(dependencyRecord.effect)) available.add(objectKey(produced));
    }
    for (const ref of record.draftRefs) {
      if (!available.has(objectKey(ref))) {
        fail(code, `${record.draftId} references an object not produced by its dependencies: ${objectKey(ref)}`, {
          draftId: record.draftId,
          reference: ref,
        });
      }
    }
  }
  validateDraftDependencyCycles(records, byId);
}

function validateDraftDependencyCycles(records, byId) {
  const state = new Map();
  const path = [];
  const pathIndex = new Map();

  function visit(record) {
    const current = state.get(record.draftId);
    if (current === "visited") return;
    if (current === "visiting") {
      const cycle = [...path.slice(pathIndex.get(record.draftId)), record.draftId];
      fail("DRAFT_DEPENDENCY_CYCLE", `Draft dependencies contain a cycle: ${cycle.join(" -> ")}`, { cycle });
    }
    state.set(record.draftId, "visiting");
    pathIndex.set(record.draftId, path.length);
    path.push(record.draftId);
    for (const dependency of record.dependencies) visit(byId.get(dependency));
    path.pop();
    pathIndex.delete(record.draftId);
    state.set(record.draftId, "visited");
  }

  for (const record of records) visit(record);
}

function validateDraftIdentities(M, records) {
  const usedIds = new Set([
    ...M.entries.map((entry) => entry.id),
    ...M.inferences.map((inference) => inference.id),
  ]);
  for (const record of records) {
    for (const produced of effectObjects(record.effect)) {
      if (usedIds.has(produced.id)) {
        fail("DRAFT_CONFLICT", `Duplicate draft mathematical identity: ${produced.id}`, {
          id: produced.id,
          kind: produced.kind,
        });
      }
      usedIds.add(produced.id);
    }
  }
}

function mathEffectReferences(effect) {
  return effectsOf(effect).flatMap((item) => {
    if (item.operation === "add_inference") {
      const references = [...(Array.isArray(item.inference.premises) ? item.inference.premises : []), item.inference.conclusion];
      if (!Array.isArray(item.inference.premises) || references.some((id) => !validReferenceId(id))) return [];
      return references.map((id) => ({ kind: "entry", id }));
    }
    if (item.operation === "add_negation_pair") {
      const references = item.negation_pair.claimEntryIds;
      return Array.isArray(references) && references.every(validReferenceId)
        ? references.map((id) => ({ kind: "entry", id }))
        : [];
    }
    if (item.operation === "add_b0_claim" && validReferenceId(item.claim_entry_id)) {
      return [{ kind: "entry", id: item.claim_entry_id }];
    }
    return [];
  });
}

function validReferenceId(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function hasExactFields(value, fields) {
  return plain(value) && Reflect.ownKeys(value).length === fields.length && fields.every((field) => own(value, field));
}

function mathRef(value, kind) {
  return hasExactFields(value, ["kind", "id"])
    && (kind ? value.kind === kind : MATH_REF_KINDS.has(value.kind))
    && validReferenceId(value.id)
    ? [{ kind: value.kind, id: value.id }]
    : [];
}

function mathRefList(value, kind) {
  if (!Array.isArray(value)) return [];
  const references = value.flatMap((item) => mathRef(item, kind));
  return references.length === value.length ? references : [];
}

function workingStateMathReferences(value) {
  return hasExactFields(value, ["remaining_gap", "obligations", "resumption_guidance", "input_refs", "forbidden_drift"])
    ? mathRefList(value.input_refs)
    : [];
}

function strategyMathReferences(value) {
  if (!hasExactFields(value, ["id", "identity", "working_state", "result_refs", "availability"])) return [];
  return [...workingStateMathReferences(value.working_state), ...mathRefList(value.result_refs)];
}

function routeRecordMathReferences(value) {
  if (!hasExactFields(value, ["id", "strategic_identity", "entry_refs", "inference_refs", "start_entry_refs", "goal_records", "current_goal_refs", "lifecycle"])) return [];
  if (!Array.isArray(value.goal_records)) return [];
  const references = [
    ...mathRefList(value.entry_refs, "entry"),
    ...mathRefList(value.inference_refs, "inference"),
    ...mathRefList(value.start_entry_refs, "entry"),
    ...mathRefList(value.current_goal_refs, "entry"),
  ];
  for (const goal of value.goal_records) {
    if (!hasExactFields(goal, ["goal_ref", "strategies"]) || !Array.isArray(goal.strategies)) return [];
    references.push(...mathRef(goal.goal_ref, "entry"));
    for (const strategy of goal.strategies) references.push(...strategyMathReferences(strategy));
  }
  return references;
}

function routeChangeMathReferences(value) {
  if (!plain(value)) return [];
  const singular = {
    add_entry: ["entry_ref", "entry", ["operation", "entry_ref"]],
    add_inference: ["inference_ref", "inference", ["operation", "inference_ref"]],
    add_start: ["entry_ref", "entry", ["operation", "entry_ref"]],
    introduce_goal: ["goal_ref", "entry", ["operation", "goal_ref", "index"]],
    pause_goal: ["goal_ref", "entry", ["operation", "goal_ref", "reason"]],
    resume_goal: ["goal_ref", "entry", ["operation", "goal_ref", "index", "reason"]],
  }[value.operation];
  if (singular) return hasExactFields(value, singular[2]) ? mathRef(value[singular[0]], singular[1]) : [];
  if (value.operation === "reorder_current_goals" && hasExactFields(value, ["operation", "goal_refs"])) {
    return mathRefList(value.goal_refs, "entry");
  }
  if (value.operation === "add_strategy" && hasExactFields(value, ["operation", "goal_ref", "strategy"])) {
    return [...mathRef(value.goal_ref, "entry"), ...strategyMathReferences(value.strategy)];
  }
  if (value.operation === "revise_strategy" && hasExactFields(value, ["operation", "strategy_ref", "working_state"])) {
    return workingStateMathReferences(value.working_state);
  }
  if (value.operation === "record_strategy_results" && hasExactFields(value, ["operation", "strategy_ref", "result_refs"])) {
    return mathRefList(value.result_refs);
  }
  return [];
}

function routeDeltaMathReferences(value) {
  if (!plain(value)) return [];
  if (value.operation === "create" && hasExactFields(value, ["operation", "route"])) {
    return routeRecordMathReferences(value.route);
  }
  if (value.operation === "update" && hasExactFields(value, ["operation", "route_ref", "changes"]) && Array.isArray(value.changes)) {
    return value.changes.flatMap(routeChangeMathReferences);
  }
  if (value.operation === "batch" && hasExactFields(value, ["operation", "route_deltas"]) && Array.isArray(value.route_deltas)) {
    if (value.route_deltas.some((delta) => plain(delta) && delta.operation === "batch")) return [];
    return value.route_deltas.flatMap(routeDeltaMathReferences);
  }
  return [];
}

function routeMathReferences(value) {
  if (!hasExactFields(value, ["route_delta", "selection_delta"])) return [];
  const references = routeDeltaMathReferences(value.route_delta);
  if (hasExactFields(value.selection_delta, ["operation", "route_ref", "goal_ref", "strategy_ref"]) && value.selection_delta.operation === "select") {
    references.push(...mathRef(value.selection_delta.goal_ref, "entry"));
  }
  return references;
}

function validateCandidateProvenance(records) {
  const producers = new Map();
  for (const record of records) {
    for (const produced of effectObjects(record.effect)) {
      producers.set(objectKey(produced), { ...produced, producerDraftId: record.draftId });
    }
  }
  for (const record of records) {
    const ownProduced = new Set(effectObjects(record.effect).map(objectKey));
    const acceptedRefs = new Set(record.acceptedRefs.map(objectKey));
    const declaredRefs = new Set(record.draftRefs.map(objectKey));
    const directDependencies = new Set(record.dependencies);
    const references = [
      ...mathEffectReferences(record.effect),
      ...routeMathReferences(record.routeEffect),
    ];
    for (const candidateRef of references) {
      const reference = objectKey(candidateRef);
      if (acceptedRefs.has(reference) || ownProduced.has(reference)) continue;
      const produced = producers.get(reference);
      if (!produced || !declaredRefs.has(reference) || !directDependencies.has(produced.producerDraftId)) {
        fail("UNKNOWN_DRAFT_REFERENCE", `${record.draftId} uses undeclared candidate object: ${reference}`, {
          draftId: record.draftId,
          reference: produced ?? candidateRef,
        });
      }
    }
  }
}

function mathDelta(records) {
  const actions = records
    .flatMap((record) => effectsOf(record.effect))
    .filter((effect) => effect.operation !== "no_change")
    .map((effect) => clone(effect, "candidate Delta M"));
  return actions.length ? { operation: "append", actions } : { operation: "no_change" };
}

function normalizeGraph(graphInput, M, pin, relationCode = "INVALID_DRAFT_GRAPH") {
  if (graphInput === null || graphInput === undefined) {
    return { schema: DRAFT_GRAPH_SCHEMA, base: clone(pin, "draft base"), drafts: [] };
  }
  closed(graphInput, new Set(["schema", "base", "drafts", "continuations"]), "draft_graph", "INVALID_DRAFT_GRAPH");
  if (graphInput.schema !== undefined && graphInput.schema !== DRAFT_GRAPH_SCHEMA) {
    fail("INVALID_DRAFT_GRAPH", `draft_graph.schema must be ${DRAFT_GRAPH_SCHEMA}`);
  }
  closed(graphInput.base, new Set(PIN_FIELDS), "draft_graph.base", "INVALID_DRAFT_GRAPH");
  if (!samePin(graphInput.base, pin)) {
    fail("STALE_DRAFT_BASE", "Draft Graph is bound to a different accepted Snapshot", { expected: pin, actual: graphInput.base });
  }
  if (!Array.isArray(graphInput.drafts)) fail("INVALID_DRAFT_GRAPH", "draft_graph.drafts must be an array");
  const drafts = clone(graphInput.drafts, "draft_graph.drafts", "INVALID_DRAFT_GRAPH");
  assertJsonCompatible(drafts, "draft_graph.drafts", "INVALID_DRAFT_GRAPH");
  const continuations = graphInput.continuations ?? [];
  assertJsonCompatible(continuations, "draft_graph.continuations", "INVALID_DRAFT_GRAPH");
  if (!Array.isArray(continuations)) fail("INVALID_DRAFT_GRAPH", "continuations must be an array");
  for (let index = 0; index < continuations.length; index += 1) {
    const event = continuations[index];
    closed(event, new Set(["base", "next", "receipt_id", "compilation_id"]), "continuation", "INVALID_DRAFT_GRAPH");
    for (const field of ["base", "next"]) {
      closed(event[field], new Set(PIN_FIELDS), `continuation.${field}`, "INVALID_DRAFT_GRAPH");
      exactString(event[field].state_id, "continuation state_id", "INVALID_DRAFT_GRAPH");
      exactString(event[field].snapshot_id, "continuation snapshot_id", "INVALID_DRAFT_GRAPH");
      if (!Number.isSafeInteger(event[field].revision) || event[field].revision < 0) fail("INVALID_DRAFT_GRAPH", "invalid continuation revision");
    }
    exactString(event.receipt_id, "continuation.receipt_id", "INVALID_DRAFT_GRAPH");
    exactString(event.compilation_id, "continuation.compilation_id", "INVALID_DRAFT_GRAPH");
    if (event.base.state_id !== event.next.state_id ||
        !(samePin(event.base, event.next) || (event.next.revision === event.base.revision + 1 && event.next.snapshot_id !== event.base.snapshot_id)) ||
        (index > 0 && !samePin(continuations[index - 1].next, event.base))) {
      fail("INVALID_DRAFT_GRAPH", "continuation chain is not consecutive");
    }
  }
  if (continuations.length && !samePin(continuations.at(-1).next, pin)) fail("STALE_DRAFT_BASE", "continuation does not reach current Snapshot");
  const historicalPins = continuations.map((event) => event.base);
  const knownActionIds = new Set();
  const records = drafts.map((record) => validateDraftRecord(record, M, pin, knownActionIds, historicalPins));
  validateCandidateProvenance(records);
  validateDraftRelations(records, relationCode);
  if (continuations.length) {
    const byId = new Map(drafts.map((draft) => [draft.draft_id, draft]));
    for (const draft of drafts) {
      if (!draft.pending && (draft.dependencies ?? []).some((id) => byId.get(id).pending)) fail("INVALID_DRAFT_GRAPH", "usable draft depends on pending content");
      if (draft.status !== "admitted") continue;
      const continuedAdmission = continuations.find((event) => samePin(event.base, draft.lineage.base)
        && event.receipt_id === draft.lineage.receipt_id && event.compilation_id === draft.lineage.compilation_id);
      // A newly settled draft can still be on the current base before its continuation.
      if (!continuedAdmission && samePin(draft.lineage.base, pin)) continue;
      if (!continuedAdmission) fail("INVALID_DRAFT_GRAPH", "admitted lineage does not match continuation history");
      for (const effect of effectsOf(draft.effect)) {
        const object = effect.operation === "add_entry" ? effect.entry : effect.operation === "add_inference" ? effect.inference : null;
        if (!object) continue;
        const collection = effect.operation === "add_entry" ? M.entries : M.inferences;
        const accepted = collection.find((item) => item.id === object.id);
        if (!accepted || digest(accepted) !== digest(object)) fail("INVALID_DRAFT_GRAPH", "admitted producer does not match accepted M");
      }
    }
  }
  const usableRecords = records.filter((record, index) => !drafts[index].pending && !(continuations.length && drafts[index].status === "admitted"));
  if (continuations.length) validateDraftIdentities({ entries: [], inferences: [] }, records);
  validateDraftIdentities(M, usableRecords);
  const result = { schema: DRAFT_GRAPH_SCHEMA, base: clone(pin, "draft base"), drafts };
  if (continuations.length) result.continuations = clone(continuations, "continuations");
  return result;
}

function buildWorkingView(snapshot, graph, pin) {
  const pending = graph.drafts.filter((draft) => draft.status === "draft" && !draft.pending);
  const common = (draft) => ({
    status: "draft",
    draft_id: draft.draft_id,
    action_id: draft.action_result.action_id,
    accepted_refs: clone(draft.accepted_refs, "accepted refs"),
    evidence_refs: own(draft.action_result, "evidence_refs") ? clone(draft.action_result.evidence_refs, "evidence refs") : [],
    lineage: clone(draft.lineage, "draft lineage"),
  });
  const entries = [];
  const inferences = [];
  const routeEffects = [];
  for (const draft of pending) {
    for (const effect of effectsOf(draft.effect)) {
      if (effect.operation === "add_entry") {
        entries.push({ ...common(draft), entry: clone(effect.entry, "draft entry") });
      }
      if (effect.operation === "add_inference") {
        inferences.push({
          ...common(draft),
          inference: clone(effect.inference, "draft inference"),
          draft_refs: clone(draft.draft_refs, "draft references"),
        });
      }
    }
    const routeEffect = routeEffectOf(draft);
    if (routeEffect !== undefined) {
      routeEffects.push({
        ...common(draft),
        route_effect: clone(routeEffect, "draft route effect"),
        draft_refs: clone(draft.draft_refs, "draft references"),
      });
    }
  }
  const admittedLineage = graph.drafts
    .filter((draft) => draft.status === "admitted")
    .map((draft) => ({
      draft_id: draft.draft_id,
      action_id: draft.action_result.action_id,
      lineage: clone(draft.lineage, "admitted lineage"),
    }));
  return {
    schema: WORKING_VIEW_SCHEMA,
    accepted: {
      state_id: pin.state_id,
      snapshot_id: pin.snapshot_id,
      revision: pin.revision,
      M: clone(snapshot.M, "accepted M"),
      R: clone(snapshot.R, "accepted R"),
    },
    draft: {
      base: clone(pin, "draft view base"),
      entries,
      inferences,
      route_effects: routeEffects,
      records: clone(pending, "draft records"),
      admitted_lineage: admittedLineage,
      ...(graph.continuations ? {
        pending_records: clone(graph.drafts.filter((draft) => draft.pending), "pending drafts"),
        admitted_dependencies: graph.drafts.filter((draft) => draft.status === "admitted" && graph.continuations.some((event) =>
          samePin(event.base, draft.lineage.base) && event.receipt_id === draft.lineage.receipt_id && event.compilation_id === draft.lineage.compilation_id
        )).map((draft) => ({
          draft_id: draft.draft_id, accepted_refs: effectObjects(draft.effect), lineage: clone(draft.lineage, "dependency lineage"),
        })),
      } : {}),
    },
  };
}

function appendActionResult(...args) {
  if (args.length !== 1 || !plain(args[0])) {
    fail("INVALID_DRAFT_REQUEST", "appendActionResult expects one request object");
  }
  const request = args[0];
  if (!plain(request)) fail("INVALID_DRAFT_REQUEST", "appendActionResult request must be an object");
  closed(request, new Set(["snapshot", "draft_graph", "action_result"]), "appendActionResult request");
  const validated = validateSnapshot(request.snapshot);
  const graph = normalizeGraph(request.draft_graph, validated.M, validated.pin);
  const action = validateActionResult(request.action_result, validated.M);
  if (graph.drafts.some((draft) => draft.draft_id === action.actionId)) {
    fail("DRAFT_CONFLICT", `Duplicate draft action identity: ${action.actionId}`, { draftId: action.actionId });
  }
  const record = {
    draft_id: action.actionId,
    status: "draft",
    action_result: clone(request.action_result, "action_result", "INVALID_ACTION_RESULT"),
    effect: clone(action.effect, "draft effect", "INVALID_ACTION_RESULT"),
    accepted_refs: clone(action.acceptedRefs, "accepted refs", "INVALID_ACTION_RESULT"),
    draft_refs: clone(action.draftRefs, "draft references", "INVALID_ACTION_RESULT"),
    dependencies: clone(action.dependencies, "draft dependencies", "INVALID_ACTION_RESULT"),
    lineage: {
      base: clone(validated.pin, "draft lineage base"),
      status: "draft",
      receipt_id: null,
      compilation_id: null,
    },
  };
  if (action.routeEffect !== undefined) {
    record.route_effect = clone(action.routeEffect, "draft route effect", "INVALID_ACTION_RESULT");
  }
  if (action.dependencies.some((id) => graph.drafts.find((draft) => draft.draft_id === id)?.pending)) {
    fail("DRAFT_PENDING", "Action Result depends on a pending draft");
  }
  const draftGraph = normalizeGraph({
    schema: DRAFT_GRAPH_SCHEMA,
    base: clone(validated.pin, "draft base"),
    drafts: [...graph.drafts, record],
    ...(graph.continuations ? { continuations: graph.continuations } : {}),
  }, validated.M, validated.pin, "UNKNOWN_DRAFT_REFERENCE");
  return {
    draft_graph: clone(draftGraph, "draft graph"),
    working_view: buildWorkingView(request.snapshot, draftGraph, validated.pin),
  };
}

function projectWorkingView(...args) {
  if (args.length !== 1 || !plain(args[0])) {
    fail("INVALID_DRAFT_REQUEST", "projectWorkingView expects one request object");
  }
  const request = args[0];
  if (!plain(request)) fail("INVALID_DRAFT_REQUEST", "projectWorkingView request must be an object");
  closed(request, new Set(["snapshot", "draft_graph"]), "projectWorkingView request");
  const validated = validateSnapshot(request.snapshot);
  const graph = normalizeGraph(request.draft_graph, validated.M, validated.pin);
  return buildWorkingView(request.snapshot, graph, validated.pin);
}

function selectionValue(selection) {
  if (!plain(selection)) fail("INVALID_COMMIT_SELECTION", "selection must be an object");
  closed(selection, new Set(["draft_ids"]), "selection", "INVALID_COMMIT_SELECTION");
  return { draft_ids: clone(selection.draft_ids, "selection.draft_ids", "INVALID_COMMIT_SELECTION") };
}

function validateSelection(selection, graph) {
  const normalized = selectionValue(selection);
  if (!Array.isArray(normalized.draft_ids) || normalized.draft_ids.length === 0) {
    fail("INVALID_COMMIT_SELECTION", "selection.draft_ids must be a non-empty array");
  }
  const ids = new Set();
  for (const id of normalized.draft_ids) {
    exactString(id, "selection.draft_ids item", "INVALID_COMMIT_SELECTION");
    if (ids.has(id)) fail("INVALID_COMMIT_SELECTION", `selection contains duplicate draft: ${id}`);
    ids.add(id);
    const draft = graph.drafts.find((item) => item.draft_id === id);
    if (!draft) fail("UNKNOWN_DRAFT_REFERENCE", `selection references unknown draft: ${id}`, { draftId: id });
    if (draft.pending) fail("DRAFT_PENDING", `selected draft requires attention: ${id}`);
    if (draft.status !== "draft" && draft.status !== "admitted") fail("INVALID_DRAFT_GRAPH", `unsupported draft status: ${draft.status}`);
  }
  for (const id of ids) {
    const draft = graph.drafts.find((item) => item.draft_id === id);
    for (const dependency of draft.dependencies ?? []) {
      if (!ids.has(dependency) && !(graph.continuations && graph.drafts.find((item) => item.draft_id === dependency)?.status === "admitted")) {
        fail("INVALID_COMMIT_SELECTION", `selection must include dependency ${dependency} of draft ${id}`, {
          draftId: id,
          dependency,
        });
      }
    }
  }
  return normalized;
}

function selectedRecords(graph, selection) {
  return selection.draft_ids.map((id) => graph.drafts.find((draft) => draft.draft_id === id));
}

function dependencyOrderedRecords(graph, records) {
  const selected = new Set(records.map((record) => record.draft_id));
  const remaining = new Set(records);
  const graphOrder = new Map(graph.drafts.map((record, index) => [record.draft_id, index]));
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter((record) => (record.dependencies ?? []).every((dependency) => !selected.has(dependency) || !remaining.has(graph.drafts.find((item) => item.draft_id === dependency))))
      .sort((left, right) => graphOrder.get(left.draft_id) - graphOrder.get(right.draft_id));
    if (ready.length === 0) fail("DRAFT_DEPENDENCY_CYCLE", "selected draft dependencies contain a cycle");
    const next = ready[0];
    remaining.delete(next);
    ordered.push(next);
  }
  return ordered;
}

function draftProvenance(record) {
  const provenance = {
    draft_id: record.draft_id,
    action_result: clone(record.action_result, "draft provenance"),
    effect: clone(record.effect, "draft provenance effect"),
    accepted_refs: clone(record.accepted_refs, "draft provenance references"),
    draft_refs: clone(record.draft_refs ?? [], "draft provenance draft references"),
    dependencies: clone(record.dependencies ?? [], "draft provenance dependencies"),
  };
  const routeEffect = record.route_effect;
  if (routeEffect !== undefined) provenance.route_effect = clone(routeEffect, "draft provenance route effect");
  return provenance;
}

function selectedProvenance(records) {
  return {
    drafts: records.map(draftProvenance),
    evidence_refs: records.flatMap((record) => own(record.action_result, "evidence_refs")
      ? clone(record.action_result.evidence_refs, "evidence refs")
      : []),
  };
}

function routeEffectOf(record) {
  return record.route_effect;
}

function compileRouteDelta(records) {
  const routeDeltas = [];
  const selectionDeltas = [];
  for (const record of records) {
    const routeEffect = routeEffectOf(record);
    if (routeEffect === undefined) continue;
    const routeDelta = routeEffect.route_delta;
    if (!(plain(routeDelta) && routeDelta.operation === "keep" && Reflect.ownKeys(routeDelta).length === 1)) {
      routeDeltas.push(clone(routeDelta, "compiled Route Delta"));
    }
    const selectionDelta = routeEffect.selection_delta;
    if (!(plain(selectionDelta) && selectionDelta.operation === "keep_current" && Reflect.ownKeys(selectionDelta).length === 1)) {
      selectionDeltas.push(clone(selectionDelta, "compiled Selection Delta"));
    }
  }
  const route = routeDeltas.length === 0
    ? clone(DEFAULT_DELTA_R.route, "compiled Route Delta")
    : routeDeltas.length === 1
      ? routeDeltas[0]
      : { operation: "batch", route_deltas: routeDeltas };
  if (selectionDeltas.length > 1) {
    fail("AMBIGUOUS_SELECTION_EFFECT", "selected drafts contain multiple non-keep Selection Deltas");
  }
  const selection = selectionDeltas.length === 0
    ? clone(DEFAULT_DELTA_R.selection, "compiled Selection Delta")
    : selectionDeltas[0];
  return { route, selection };
}

function compileDelta(M, R, records) {
  const delta = mathDelta(records);
  const math = transitionMathState(M, delta);
  const deltaR = compileRouteDelta(records);
  transitionRouteState(math.next_m, R, deltaR.route, deltaR.selection);
  return { delta, deltaR };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return `sha256:${createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")}`;
}

function compileResearchCommit(...args) {
  if (args.length !== 1 || !plain(args[0])) {
    fail("INVALID_DRAFT_REQUEST", "prepareResearchCommit expects one request object");
  }
  const request = args[0];
  if (!plain(request)) fail("INVALID_DRAFT_REQUEST", "prepareResearchCommit request must be an object");
  closed(request, new Set(["snapshot", "draft_graph", "selection"]), "prepareResearchCommit request");
  const validated = validateSnapshot(request.snapshot);
  const graph = normalizeGraph(request.draft_graph, validated.M, validated.pin);
  const selection = validateSelection(request.selection, graph);
  const records = dependencyOrderedRecords(graph, selectedRecords(graph, selection));
  if (records.some((record) => record.status === "admitted")) {
    fail("DRAFT_ALREADY_ADMITTED", "an admitted draft cannot be selected for a new Research Commit");
  }
  const { delta, deltaR } = compileDelta(validated.M, validated.R, records);
  const draftIds = clone(selection.draft_ids, "selected draft IDs");
  const provenance = selectedProvenance(records);
  const compilationId = digest({ capability: CAPABILITY_ID, base: validated.pin, selection, delta_m: delta, delta_r: deltaR, provenance });
  const prepared = {
    capability: CAPABILITY_ID,
    base: clone(validated.pin, "compiled base"),
    selection: clone(selection, "compiled selection"),
    draft_ids: draftIds,
    delta_m: clone(delta, "compiled Delta M"),
    delta_r: clone(deltaR, "compiled Delta R"),
    provenance,
    compilation_id: compilationId,
  };
  return prepared;
}

function validateReceiptShape(receipt) {
  if (!plain(receipt)) fail("INVALID_COMMIT_RECEIPT", "receipt must be an object");
  closed(receipt, RECEIPT_FIELDS, "receipt", "INVALID_COMMIT_RECEIPT");
  for (const field of RECEIPT_FIELDS) {
    if (!own(receipt, field)) fail("INVALID_COMMIT_RECEIPT", `receipt is missing field: ${field}`);
  }
  exactString(receipt.receipt_id, "receipt.receipt_id", "INVALID_COMMIT_RECEIPT");
  if (!SUCCESS_RECEIPT_STATUSES.has(receipt.status) && !FAILED_RECEIPT_STATUSES.has(receipt.status)) {
    fail("INVALID_COMMIT_RECEIPT", `unknown Commit Receipt status: ${receipt.status}`);
  }
  if (!plain(receipt.base)) fail("INVALID_COMMIT_RECEIPT", "receipt.base must be an object");
  closed(receipt.base, new Set(PIN_FIELDS), "receipt.base", "INVALID_COMMIT_RECEIPT");
  exactString(receipt.base.state_id, "receipt.base.state_id", "INVALID_COMMIT_RECEIPT");
  exactString(receipt.base.snapshot_id, "receipt.base.snapshot_id", "INVALID_COMMIT_RECEIPT");
  if (!Number.isSafeInteger(receipt.base.revision) || receipt.base.revision < 0) {
    fail("INVALID_COMMIT_RECEIPT", "receipt.base.revision must be a non-negative safe integer");
  }
  try {
    const selection = selectionValue(receipt.selection);
    if (!Array.isArray(selection.draft_ids) || selection.draft_ids.length === 0) {
      fail("INVALID_COMMIT_RECEIPT", "receipt.selection.draft_ids must be a non-empty array");
    }
    const seen = new Set();
    for (const id of selection.draft_ids) {
      exactString(id, "receipt.selection.draft_ids item", "INVALID_COMMIT_RECEIPT");
      if (seen.has(id)) fail("INVALID_COMMIT_RECEIPT", `receipt.selection contains duplicate draft: ${id}`);
      seen.add(id);
    }
  } catch (error) {
    if (error.code === "INVALID_COMMIT_RECEIPT") throw error;
    fail("INVALID_COMMIT_RECEIPT", error.message);
  }
  exactString(receipt.compilation_id, "receipt.compilation_id", "INVALID_COMMIT_RECEIPT");
  return receipt.status;
}

function validateDeltaR(value, code = "INVALID_COMMIT_RECEIPT") {
  if (!plain(value)) fail(code, "delta_r must be an object");
  closed(value, new Set(["route", "selection"]), "delta_r", code);
  if (!plain(value.route)) fail(code, "delta_r.route must be an object");
  exactString(value.route.operation, "delta_r.route.operation", code);
  if (!plain(value.selection)) fail(code, "delta_r.selection must be an object");
  exactString(value.selection.operation, "delta_r.selection.operation", code);
}

function validatePreparedShape(prepared) {
  if (!plain(prepared)) fail("INVALID_COMMIT_RECEIPT", "prepared commit must be an object");
  closed(prepared, PREPARED_FIELDS, "prepared commit", "INVALID_COMMIT_RECEIPT");
  for (const field of PREPARED_FIELDS) {
    if (!own(prepared, field)) fail("INVALID_COMMIT_RECEIPT", `prepared commit is missing field: ${field}`);
  }
  exactString(prepared.capability, "prepared.capability", "INVALID_COMMIT_RECEIPT");
  if (!plain(prepared.base)) fail("INVALID_COMMIT_RECEIPT", "prepared.base must be an object");
  closed(prepared.base, new Set(PIN_FIELDS), "prepared.base", "INVALID_COMMIT_RECEIPT");
  exactString(prepared.base.state_id, "prepared.base.state_id", "INVALID_COMMIT_RECEIPT");
  exactString(prepared.base.snapshot_id, "prepared.base.snapshot_id", "INVALID_COMMIT_RECEIPT");
  if (!Number.isSafeInteger(prepared.base.revision) || prepared.base.revision < 0) {
    fail("INVALID_COMMIT_RECEIPT", "prepared.base.revision must be a non-negative safe integer");
  }
  const selection = selectionValue(prepared.selection);
  if (!Array.isArray(selection.draft_ids) || selection.draft_ids.length === 0) {
    fail("INVALID_COMMIT_RECEIPT", "prepared.selection.draft_ids must be a non-empty array");
  }
  for (const id of selection.draft_ids) exactString(id, "prepared.selection.draft_ids item", "INVALID_COMMIT_RECEIPT");
  if (!Array.isArray(prepared.draft_ids)) fail("INVALID_COMMIT_RECEIPT", "prepared.draft_ids must be an array");
  validateDeltaR(prepared.delta_r);
  exactString(prepared.compilation_id, "prepared.compilation_id", "INVALID_COMMIT_RECEIPT");
}

function receiptMatches(receipt, prepared) {
  return samePin(receipt.base, prepared.base)
    && JSON.stringify(selectionValue(receipt.selection)) === JSON.stringify(prepared.selection)
    && receipt.compilation_id === prepared.compilation_id;
}

function settleResearchCommit(...args) {
  if (args.length !== 1 || !plain(args[0])) {
    fail("INVALID_DRAFT_REQUEST", "settleResearchCommit expects one request object");
  }
  const request = args[0];
  if (!plain(request)) fail("INVALID_DRAFT_REQUEST", "settleResearchCommit request must be an object");
  closed(request, new Set(["snapshot", "draft_graph", "prepared", "receipt"]), "settleResearchCommit request");
  const validated = validateSnapshot(request.snapshot);
  const graph = normalizeGraph(request.draft_graph, validated.M, validated.pin);
  const receipt = request.receipt;
  const receiptState = validateReceiptShape(receipt);
  const currentView = () => ({ draft_graph: clone(graph, "draft graph"), working_view: buildWorkingView(request.snapshot, graph, validated.pin) });
  const prepared = request.prepared;
  validatePreparedShape(prepared);
  if (prepared.capability !== CAPABILITY_ID || !samePin(prepared.base, validated.pin)) {
    fail("RECEIPT_MISMATCH", "prepared commit is not bound to the accepted Snapshot");
  }
  let selection;
  try {
    selection = validateSelection(prepared.selection, graph);
  } catch (error) {
    if (error.code === "UNKNOWN_DRAFT_REFERENCE" || error.code === "INVALID_COMMIT_SELECTION") {
      fail("RECEIPT_MISMATCH", "prepared selection is not bound to the current Draft Graph");
    }
    throw error;
  }
  if (JSON.stringify(selection) !== JSON.stringify(prepared.selection) || JSON.stringify(prepared.draft_ids) !== JSON.stringify(selection.draft_ids)) {
    fail("RECEIPT_MISMATCH", "prepared selection binding is invalid");
  }
  const records = dependencyOrderedRecords(graph, selectedRecords(graph, selection));
  const { delta, deltaR } = compileDelta(validated.M, validated.R, records);
  const provenance = selectedProvenance(records);
  const expectedCompilationId = digest({ capability: CAPABILITY_ID, base: validated.pin, selection, delta_m: delta, delta_r: deltaR, provenance });
  if (prepared.compilation_id !== expectedCompilationId
    || JSON.stringify(prepared.delta_m) !== JSON.stringify(delta)
    || JSON.stringify(prepared.delta_r) !== JSON.stringify(deltaR)
    || JSON.stringify(prepared.provenance) !== JSON.stringify(provenance)) {
    fail("RECEIPT_MISMATCH", "prepared commit does not match the selected draft");
  }
  if (!receiptMatches(receipt, prepared)) fail("RECEIPT_MISMATCH", "Commit Receipt does not match base, selection, or compiled request");
  if (receiptState === "failed") return { status: "unchanged", ...currentView() };
  const nextGraph = clone(graph, "draft graph");
  for (const id of selection.draft_ids) {
    const draft = nextGraph.drafts.find((item) => item.draft_id === id);
    if (draft.status === "admitted") {
      if (draft.lineage.receipt_id !== receipt.receipt_id || draft.lineage.compilation_id !== prepared.compilation_id) {
        fail("RECEIPT_MISMATCH", "Commit Receipt does not match admitted draft lineage");
      }
      continue;
    }
    draft.status = "admitted";
    draft.lineage = {
      base: clone(validated.pin, "admitted lineage base"),
      status: "admitted",
      receipt_id: receipt.receipt_id,
      compilation_id: prepared.compilation_id,
    };
  }
  return {
    status: "admitted",
    draft_graph: nextGraph,
    working_view: buildWorkingView(request.snapshot, nextGraph, validated.pin),
  };
}

function continueResearchDrafts(...args) {
  if (args.length !== 1 || !plain(args[0])) fail("INVALID_DRAFT_REQUEST", "continueResearchDrafts expects one request object");
  const request = args[0];
  closed(request, new Set(["snapshot", "draft_graph", "prepared", "receipt", "next_snapshot"]), "continueResearchDrafts request");
  const { next_snapshot: nextSnapshot, ...settlement } = request;
  const settled = settleResearchCommit(settlement);
  if (settled.status !== "admitted") fail("INVALID_COMMIT_RECEIPT", "continuation requires a successful Receipt");
  const before = validateSnapshot(request.snapshot);
  const after = validateSnapshot(nextSnapshot);
  const math = transitionMathState(before.M, request.prepared.delta_m);
  const route = transitionRouteState(math.next_m, before.R, request.prepared.delta_r.route, request.prepared.delta_r.selection);
  const changed = digest({ M: before.M, R: before.R }) !== digest({ M: math.next_m, R: route.route_state });
  if (after.pin.state_id !== before.pin.state_id ||
      after.pin.revision !== before.pin.revision + (changed ? 1 : 0) ||
      (changed ? after.pin.snapshot_id === before.pin.snapshot_id : !samePin(after.pin, before.pin)) ||
      digest({ M: after.M, R: after.R }) !== digest({ M: math.next_m, R: route.route_state })) {
    fail("UNEXPECTED_SUCCESSOR", "next_snapshot does not match the compiled successful transition");
  }
  const graph = settled.draft_graph;
  graph.base = clone(after.pin, "continued base");
  graph.continuations = [...(graph.continuations ?? []), {
    base: before.pin, next: after.pin, receipt_id: request.receipt.receipt_id, compilation_id: request.prepared.compilation_id,
  }];
  const pending = graph.drafts.filter((record) => record.status === "draft");
  const ordered = dependencyOrderedRecords(graph, pending);
  const byId = new Map(graph.drafts.map((record) => [record.draft_id, record]));
  for (const record of ordered) {
    if (record.pending) continue;
    if ((record.dependencies ?? []).some((id) => byId.get(id).pending)) {
      record.pending = { code: "DRAFT_PENDING", message: "A dependency requires attention" };
      continue;
    }
    // ponytail: check each dependency closure independently; cache closures if large graphs become slow.
    const closure = new Set();
    function include(current) {
      if (current.status === "admitted" || closure.has(current)) return;
      closure.add(current);
      for (const id of current.dependencies ?? []) include(byId.get(id));
    }
    include(record);
    try {
      compileDelta(after.M, after.R, dependencyOrderedRecords(graph, [...closure]));
    } catch (error) {
      if (typeof error.code !== "string") throw error;
      record.pending = { code: error.code, message: error.message };
    }
  }
  const normalized = normalizeGraph(graph, after.M, after.pin);
  return { status: "continued", draft_graph: normalized, working_view: buildWorkingView(nextSnapshot, normalized, after.pin) };
}

module.exports = Object.freeze({
  CAPABILITY_ID,
  DRAFT_GRAPH_SCHEMA,
  WORKING_VIEW_SCHEMA,
  appendActionResult,
  projectWorkingView,
  prepareResearchCommit: compileResearchCommit,
  settleResearchCommit,
  continueResearchDrafts,
});

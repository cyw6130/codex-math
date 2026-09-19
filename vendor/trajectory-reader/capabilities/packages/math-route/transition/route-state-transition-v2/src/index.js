"use strict";

const { deriveRouteState } = require("../../../state/route-state-v3/src/index.js");

const CAPABILITY_ID = "cmath.route-state-transition/v2";

const ROUTE_FIELDS = ["operation"];
const MATH_REF_KINDS = new Set(["entry", "inference"]);
const WORKING_STATE_FIELDS = [
  "remaining_gap",
  "obligations",
  "resumption_guidance",
  "input_refs",
  "forbidden_drift",
];

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function cloneValue(value, label) {
  try {
    return structuredClone(value);
  } catch {
    fail("INVALID_DELTA", `${label} must be structured-cloneable`);
  }
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value, fields, label) {
  if (!plain(value)) fail("INVALID_DELTA", `${label} must be an object`);
  const allowed = new Set(fields);
  for (const field of Reflect.ownKeys(value)) {
    if (typeof field !== "string") fail("INVALID_DELTA", `${label} contains an unknown symbol field`);
    if (!allowed.has(field)) fail("INVALID_DELTA", `${label} contains unknown field: ${field}`, { field });
  }
  for (const field of fields) {
    if (!(field in value)) fail("INVALID_DELTA", `${label} is missing field: ${field}`, { field });
  }
}

function rejectSymbolKeys(value, label, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  let keys;
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    fail("INVALID_DELTA", `${label} must be inspectable`);
  }
  for (const key of keys) {
    if (typeof key === "symbol") fail("INVALID_DELTA", `${label} contains an unknown symbol field`);
    let nested;
    try {
      nested = value[key];
    } catch {
      fail("INVALID_DELTA", `${label}.${key} must be readable`);
    }
    rejectSymbolKeys(nested, `${label}.${key}`, seen);
  }
}

function nonempty(value, label) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail("INVALID_DELTA", `${label} must be a non-empty exact string`);
  }
  return value;
}

function refId(value, kind, label) {
  exactFields(value, ["kind", "id"], label);
  if (value.kind !== kind) fail("INVALID_DELTA", `${label} must be a ${kind} ref`);
  return nonempty(value.id, `${label}.id`);
}

function mathRefList(value, label, context) {
  if (!Array.isArray(value)) fail("INVALID_DELTA", `${label} must be an array`);
  const refs = [];
  const seen = new Set();
  for (const item of value) {
    if (!plain(item) || !MATH_REF_KINDS.has(item.kind)) {
      fail("INVALID_DELTA", `${label} must contain Entry or Inference refs`);
    }
    const id = refId(item, item.kind, `${label} item`);
    const key = `${item.kind}:${id}`;
    if (seen.has(key)) fail("INVALID_DELTA", `${label} contains duplicate ref: ${key}`);
    seen.add(key);
    if (context) {
      const exists = item.kind === "entry"
        ? context.entriesById.has(id)
        : context.inferencesById.has(id);
      if (!exists) fail("INVALID_DELTA", `${label} references unknown mathematical object: ${id}`);
    }
    refs.push({ kind: item.kind, id });
  }
  return refs;
}

function stringList(value, label) {
  if (!Array.isArray(value)) fail("INVALID_DELTA", `${label} must be an array`);
  const seen = new Set();
  for (const item of value) {
    nonempty(item, `${label} item`);
    if (seen.has(item)) fail("INVALID_DELTA", `${label} contains a duplicate item`);
    seen.add(item);
  }
}

function nullableNonempty(value, label) {
  if (value !== null) nonempty(value, label);
}

function validateWorkingState(value, label, context) {
  exactFields(value, WORKING_STATE_FIELDS, label);
  nullableNonempty(value.remaining_gap, `${label}.remaining_gap`);
  stringList(value.obligations, `${label}.obligations`);
  nullableNonempty(value.resumption_guidance, `${label}.resumption_guidance`);
  mathRefList(value.input_refs, `${label}.input_refs`, context);
  stringList(value.forbidden_drift, `${label}.forbidden_drift`);
}

function validateStrategy(value, label, context) {
  exactFields(value, ["id", "identity", "working_state", "result_refs", "availability"], label);
  nonempty(value.id, `${label}.id`);
  exactFields(value.identity, ["statement", "distinction"], `${label}.identity`);
  nonempty(value.identity.statement, `${label}.identity.statement`);
  nonempty(value.identity.distinction, `${label}.identity.distinction`);
  validateWorkingState(value.working_state, `${label}.working_state`, context);
  mathRefList(value.result_refs, `${label}.result_refs`, context);
  exactFields(value.availability, ["state"], `${label}.availability`);
  if (value.availability.state !== "available") {
    fail("INVALID_DELTA", `${label}.availability.state must be available for add_strategy`);
  }
  return value.id;
}

function hasRef(refs, kind, id) {
  return refs.some((item) => item.kind === kind && item.id === id);
}

function addRef(refs, kind, id) {
  if (!hasRef(refs, kind, id)) refs.push({ kind, id });
}

function insertionIndex(value, length, label) {
  if (!Number.isInteger(value) || value < 0 || value > length) {
    fail("INVALID_DELTA", `${label} must be an integer between 0 and ${length}`);
  }
  return value;
}

function routeGoalIndex(route, goalId) {
  return route.goal_records.findIndex((record) => record.goal_ref.id === goalId);
}

function currentGoalIndex(route, goalId) {
  return route.current_goal_refs.findIndex((ref) => ref.id === goalId);
}

function strategyLocation(route, strategyId) {
  for (const goalRecord of route.goal_records) {
    const strategyIndex = goalRecord.strategies.findIndex((strategy) => strategy.id === strategyId);
    if (strategyIndex >= 0) return { goalRecord, strategy: goalRecord.strategies[strategyIndex] };
  }
  return null;
}

function requireRouteEntry(route, context, entryId, label) {
  if (!context.entriesById.has(entryId)) fail("INVALID_DELTA", `${label} references unknown Entry: ${entryId}`);
  if (!hasRef(route.entry_refs, "entry", entryId)) {
    fail("INVALID_DELTA", `${label} Entry must already be in the Route subgraph: ${entryId}`);
  }
  return context.entriesById.get(entryId);
}

function requireGoal(route, context, goalId, label) {
  const entry = requireRouteEntry(route, context, goalId, label);
  if (entry.entryClass !== "claim") fail("INVALID_DELTA", `${label} must reference a Claim: ${goalId}`);
  return entry;
}

function claimState(M, route, goalId) {
  // A minimal probe lets route-state-v3 remain the sole Route invariant source
  // while exposing the global Claim projection needed by introduce/resume.
  if (route.start_entry_refs.some((ref) => ref.id === goalId)) return "established";
  const start = route.start_entry_refs.find((ref) => ref.id !== goalId);
  if (!start) return "established";
  const probeId = "__route_state_transition_v2_claim_probe__";
  const probe = {
    id: probeId,
    strategic_identity: { statement: "Claim state probe.", distinction: "Internal transition validation probe." },
    entry_refs: [{ kind: "entry", id: start.id }, { kind: "entry", id: goalId }],
    inference_refs: [],
    start_entry_refs: [{ kind: "entry", id: start.id }],
    goal_records: [{ goal_ref: { kind: "entry", id: goalId }, strategies: [] }],
    current_goal_refs: [{ kind: "entry", id: goalId }],
    lifecycle: { state: "active" },
  };
  const projection = deriveRouteState(M, { routes: [probe], focus: null });
  const progress = projection.route_progress[probeId];
  if (progress.open_goal_ids.includes(goalId)) return "open";
  if (progress.refuted_goal_ids.includes(goalId)) return "refuted";
  return "established";
}

function applyRouteChange(M, route, change, context) {
  if (!plain(change)) fail("INVALID_DELTA", "Route update change must be an object");

  switch (change.operation) {
    case "add_entry": {
      exactFields(change, ["operation", "entry_ref"], "add_entry change");
      const entryId = refId(change.entry_ref, "entry", "add_entry.entry_ref");
      if (!context.entriesById.has(entryId)) fail("INVALID_DELTA", `unknown Entry: ${entryId}`);
      if (hasRef(route.entry_refs, "entry", entryId)) fail("INVALID_DELTA", `Route already contains Entry: ${entryId}`);
      route.entry_refs.push({ kind: "entry", id: entryId });
      return;
    }
    case "add_inference": {
      exactFields(change, ["operation", "inference_ref"], "add_inference change");
      const inferenceId = refId(change.inference_ref, "inference", "add_inference.inference_ref");
      const inference = context.inferencesById.get(inferenceId);
      if (!inference) fail("INVALID_DELTA", `unknown Inference: ${inferenceId}`);
      if (hasRef(route.inference_refs, "inference", inferenceId)) {
        fail("INVALID_DELTA", `Route already contains Inference: ${inferenceId}`);
      }
      route.inference_refs.push({ kind: "inference", id: inferenceId });
      for (const entryId of [...inference.premises, inference.conclusion]) addRef(route.entry_refs, "entry", entryId);
      return;
    }
    case "add_start": {
      exactFields(change, ["operation", "entry_ref"], "add_start change");
      const entryId = refId(change.entry_ref, "entry", "add_start.entry_ref");
      requireRouteEntry(route, context, entryId, "add_start");
      if (hasRef(route.start_entry_refs, "entry", entryId)) fail("INVALID_DELTA", `Route already contains start: ${entryId}`);
      route.start_entry_refs.push({ kind: "entry", id: entryId });
      return;
    }
    case "introduce_goal": {
      exactFields(change, ["operation", "goal_ref", "index"], "introduce_goal change");
      const goalId = refId(change.goal_ref, "entry", "introduce_goal.goal_ref");
      const index = insertionIndex(change.index, route.current_goal_refs.length, "introduce_goal.index");
      requireGoal(route, context, goalId, "introduce_goal");
      if (routeGoalIndex(route, goalId) >= 0) fail("INVALID_DELTA", `Route already has a Goal Record: ${goalId}`);
      const state = claimState(M, route, goalId);
      if (state !== "open" && state !== "refuted") {
        fail("INVALID_DELTA", `introduce_goal requires an open or refuted Claim: ${goalId}`);
      }
      route.goal_records.push({ goal_ref: { kind: "entry", id: goalId }, strategies: [] });
      route.current_goal_refs.splice(index, 0, { kind: "entry", id: goalId });
      return;
    }
    case "pause_goal": {
      exactFields(change, ["operation", "goal_ref", "reason"], "pause_goal change");
      const goalId = refId(change.goal_ref, "entry", "pause_goal.goal_ref");
      nonempty(change.reason, "pause_goal.reason");
      requireGoal(route, context, goalId, "pause_goal");
      const currentIndex = currentGoalIndex(route, goalId);
      if (routeGoalIndex(route, goalId) < 0) fail("INVALID_DELTA", `Route has no Goal Record: ${goalId}`);
      if (currentIndex < 0) fail("INVALID_DELTA", `Goal is not current: ${goalId}`);
      route.current_goal_refs.splice(currentIndex, 1);
      return;
    }
    case "resume_goal": {
      exactFields(change, ["operation", "goal_ref", "index", "reason"], "resume_goal change");
      const goalId = refId(change.goal_ref, "entry", "resume_goal.goal_ref");
      const index = insertionIndex(change.index, route.current_goal_refs.length, "resume_goal.index");
      nonempty(change.reason, "resume_goal.reason");
      requireGoal(route, context, goalId, "resume_goal");
      if (routeGoalIndex(route, goalId) < 0) fail("INVALID_DELTA", `Route has no historical Goal Record: ${goalId}`);
      if (currentGoalIndex(route, goalId) >= 0) fail("INVALID_DELTA", `Goal is already current: ${goalId}`);
      const state = claimState(M, route, goalId);
      if (state !== "open" && state !== "refuted") fail("INVALID_DELTA", `resume_goal requires an open or refuted Claim: ${goalId}`);
      route.current_goal_refs.splice(index, 0, { kind: "entry", id: goalId });
      return;
    }
    case "reorder_current_goals": {
      exactFields(change, ["operation", "goal_refs"], "reorder_current_goals change");
      if (!Array.isArray(change.goal_refs)) fail("INVALID_DELTA", "reorder_current_goals.goal_refs must be an array");
      const ids = change.goal_refs.map((item) => refId(item, "entry", "reorder_current_goals goal ref"));
      const currentIds = route.current_goal_refs.map((item) => item.id);
      if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
        fail("INVALID_DELTA", "reorder_current_goals must be an exact permutation of current goals");
      }
      route.current_goal_refs = ids.map((id) => ({ kind: "entry", id }));
      return;
    }
    case "add_strategy": {
      exactFields(change, ["operation", "goal_ref", "strategy"], "add_strategy change");
      const goalId = refId(change.goal_ref, "entry", "add_strategy.goal_ref");
      const goalIndex = routeGoalIndex(route, goalId);
      if (goalIndex < 0) fail("INVALID_DELTA", `Route has no Goal Record: ${goalId}`);
      const strategyId = validateStrategy(change.strategy, "add_strategy.strategy", context);
      if (strategyLocation(route, strategyId)) fail("INVALID_DELTA", `Route already contains Strategy ID: ${strategyId}`);
      route.goal_records[goalIndex].strategies.push(cloneValue(change.strategy, "add_strategy.strategy"));
      return;
    }
    case "revise_strategy": {
      exactFields(change, ["operation", "strategy_ref", "working_state"], "revise_strategy change");
      const strategyId = refId(change.strategy_ref, "strategy", "revise_strategy.strategy_ref");
      validateWorkingState(change.working_state, "revise_strategy.working_state", context);
      const location = strategyLocation(route, strategyId);
      if (!location) fail("INVALID_DELTA", `Route has no Strategy: ${strategyId}`);
      location.strategy.working_state = cloneValue(change.working_state, "revise_strategy.working_state");
      return;
    }
    case "record_strategy_results": {
      exactFields(change, ["operation", "strategy_ref", "result_refs"], "record_strategy_results change");
      const strategyId = refId(change.strategy_ref, "strategy", "record_strategy_results.strategy_ref");
      const resultRefs = mathRefList(change.result_refs, "record_strategy_results.result_refs", context);
      if (resultRefs.length === 0) fail("INVALID_DELTA", "record_strategy_results.result_refs must be non-empty");
      const location = strategyLocation(route, strategyId);
      if (!location) fail("INVALID_DELTA", `Route has no Strategy: ${strategyId}`);
      const recorded = new Set(location.strategy.result_refs.map((item) => `${item.kind}:${item.id}`));
      for (const resultRef of resultRefs) {
        const key = `${resultRef.kind}:${resultRef.id}`;
        if (recorded.has(key)) fail("INVALID_DELTA", `Strategy already records result: ${key}`);
        recorded.add(key);
      }
      for (const resultRef of resultRefs) {
        location.strategy.result_refs.push(resultRef);
        if (resultRef.kind === "entry") {
          addRef(route.entry_refs, "entry", resultRef.id);
          continue;
        }
        addRef(route.inference_refs, "inference", resultRef.id);
        const inference = context.inferencesById.get(resultRef.id);
        for (const entryId of [...inference.premises, inference.conclusion]) addRef(route.entry_refs, "entry", entryId);
      }
      return;
    }
    case "retire_strategy": {
      exactFields(change, ["operation", "strategy_ref", "disposition", "reason"], "retire_strategy change");
      const strategyId = refId(change.strategy_ref, "strategy", "retire_strategy.strategy_ref");
      if (change.disposition !== "exhausted" && change.disposition !== "withdrawn") {
        fail("INVALID_DELTA", "retire_strategy.disposition must be exhausted or withdrawn");
      }
      nonempty(change.reason, "retire_strategy.reason");
      const location = strategyLocation(route, strategyId);
      if (!location) fail("INVALID_DELTA", `Route has no Strategy: ${strategyId}`);
      if (location.strategy.availability.state !== "available") fail("INVALID_DELTA", `Strategy is already retired: ${strategyId}`);
      location.strategy.availability = {
        state: "retired",
        disposition: change.disposition,
        reason: change.reason,
      };
      return;
    }
    case "restore_strategy": {
      exactFields(change, ["operation", "strategy_ref", "basis"], "restore_strategy change");
      const strategyId = refId(change.strategy_ref, "strategy", "restore_strategy.strategy_ref");
      nonempty(change.basis, "restore_strategy.basis");
      const location = strategyLocation(route, strategyId);
      if (!location) fail("INVALID_DELTA", `Route has no Strategy: ${strategyId}`);
      if (location.strategy.availability.state !== "retired") fail("INVALID_DELTA", `Strategy is not retired: ${strategyId}`);
      location.strategy.availability = { state: "available" };
      return;
    }
    default:
      fail("INVALID_DELTA", `unsupported Route update operation: ${change.operation}`);
  }
}

function applyRouteDelta(M, routes, routeDelta, context) {
  if (!plain(routeDelta)) fail("INVALID_DELTA", "Route Delta must be an object");

  if (routeDelta.operation === "batch") {
    exactFields(routeDelta, ["operation", "route_deltas"], "batch Route Delta");
    if (!Array.isArray(routeDelta.route_deltas) || routeDelta.route_deltas.length === 0) {
      fail("INVALID_DELTA", "batch Route Delta.route_deltas must be non-empty");
    }
    let nextRoutes = routes;
    for (const childDelta of routeDelta.route_deltas) {
      if (!plain(childDelta)) fail("INVALID_DELTA", "batch Route Delta.route_deltas must contain objects");
      if (childDelta.operation === "batch") fail("INVALID_DELTA", "batch Route Delta cannot be nested");
      nextRoutes = applyRouteDelta(M, nextRoutes, childDelta, context);
    }
    return nextRoutes;
  }

  if (routeDelta.operation === "keep") {
    exactFields(routeDelta, ROUTE_FIELDS, "keep Route Delta");
    return routes.map((route) => cloneValue(route, "Route"));
  }

  if (routeDelta.operation === "create") {
    exactFields(routeDelta, ["operation", "route"], "create Route Delta");
    if (!plain(routeDelta.route) || routeDelta.route.lifecycle?.state !== "active") {
      fail("INVALID_DELTA", "create Route Delta requires a complete active Route");
    }
    return [...routes.map((route) => cloneValue(route, "Route")), cloneValue(routeDelta.route, "create Route Delta.route")];
  }

  if (routeDelta.operation === "update") {
    exactFields(routeDelta, ["operation", "route_ref", "changes"], "update Route Delta");
    const routeId = refId(routeDelta.route_ref, "route", "update Route Delta.route_ref");
    if (!Array.isArray(routeDelta.changes) || routeDelta.changes.length === 0) {
      fail("INVALID_DELTA", "update Route Delta.changes must be non-empty");
    }
    const routeIndex = routes.findIndex((route) => route.id === routeId);
    if (routeIndex < 0 || routes[routeIndex].lifecycle.state !== "active") {
      fail("INVALID_DELTA", "update Route Delta requires an active Route");
    }
    const next = routes.map((route) => cloneValue(route, "Route"));
    for (const change of routeDelta.changes) applyRouteChange(M, next[routeIndex], change, context);
    return next;
  }

  if (routeDelta.operation === "withdraw") {
    exactFields(routeDelta, ["operation", "route_ref", "reason"], "withdraw Route Delta");
    const routeId = refId(routeDelta.route_ref, "route", "withdraw Route Delta.route_ref");
    nonempty(routeDelta.reason, "withdraw Route Delta.reason");
    const routeIndex = routes.findIndex((route) => route.id === routeId);
    if (routeIndex < 0 || routes[routeIndex].lifecycle.state !== "active") {
      fail("INVALID_DELTA", "withdraw Route Delta requires an active Route");
    }
    const next = routes.map((route) => cloneValue(route, "Route"));
    next[routeIndex].lifecycle = { state: "withdrawn", reason: routeDelta.reason };
    return next;
  }

  fail("INVALID_DELTA", "Route Delta operation must be keep, create, update, withdraw, or batch");
}

function applySelection(baseFocus, selectionDelta) {
  if (!plain(selectionDelta)) fail("INVALID_DELTA", "Selection Delta must be an object");
  if (selectionDelta.operation === "keep_current") {
    exactFields(selectionDelta, ["operation"], "keep_current Selection Delta");
    return cloneValue(baseFocus, "base Focus");
  }
  if (selectionDelta.operation === "select") {
    exactFields(selectionDelta, ["operation", "route_ref", "goal_ref", "strategy_ref"], "select Selection Delta");
    return {
      route_ref: { kind: "route", id: refId(selectionDelta.route_ref, "route", "select.route_ref") },
      goal_ref: { kind: "entry", id: refId(selectionDelta.goal_ref, "entry", "select.goal_ref") },
      strategy_ref: { kind: "strategy", id: refId(selectionDelta.strategy_ref, "strategy", "select.strategy_ref") },
    };
  }
  if (selectionDelta.operation === "clear") {
    exactFields(selectionDelta, ["operation"], "clear Selection Delta");
    return null;
  }
  fail("INVALID_DELTA", "Selection Delta operation must be keep_current, select, or clear");
}

function settleEstablishedGoals(M, routes) {
  return routes.map((route) => {
    const next = cloneValue(route, "Route");
    next.current_goal_refs = next.current_goal_refs.filter((ref) => claimState(M, next, ref.id) !== "established");
    return next;
  });
}

function transitionRouteState(M, R, routeDelta, selectionDelta) {
  if (arguments.length !== 4) {
    fail("INVALID_DELTA", "transitionRouteState accepts exactly M, R, RouteDelta, and SelectionDelta");
  }
  const base = deriveRouteState(M, R);
  rejectSymbolKeys(routeDelta, "Route Delta");
  rejectSymbolKeys(selectionDelta, "Selection Delta");
  const context = {
    entriesById: new Map(M.entries.map((entry) => [entry.id, entry])),
    inferencesById: new Map(M.inferences.map((inference) => [inference.id, inference])),
  };

  const changedRoutes = applyRouteDelta(M, base.routes, routeDelta, context);
  const settledRoutes = settleEstablishedGoals(M, changedRoutes);
  const focus = applySelection(base.focus, selectionDelta);
  const nextRouteState = { routes: settledRoutes, focus };
  const finalProjection = deriveRouteState(M, nextRouteState);

  if (selectionDelta.operation === "select" && finalProjection.focus_status.status !== "current") {
    fail("INVALID_FOCUS", "select Selection Delta must produce a current Focus");
  }

  const acceptedRouteDelta = cloneValue(routeDelta, "Route Delta");
  const acceptedSelectionDelta = cloneValue(selectionDelta, "Selection Delta");

  return {
    route_state: nextRouteState,
    accepted_route_delta: acceptedRouteDelta,
    accepted_selection_delta: acceptedSelectionDelta,
  };
}

module.exports = Object.freeze({ CAPABILITY_ID, transitionRouteState });

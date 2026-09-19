"use strict";

const { deriveMathState } = require("../../../../math-map/state/math-graph-semantics-v3/src/index.js");

const CAPABILITY_ID = "cmath.route-state/v3";

const ROUTE_FIELDS = new Set([
  "id",
  "strategic_identity",
  "entry_refs",
  "inference_refs",
  "start_entry_refs",
  "goal_records",
  "current_goal_refs",
  "lifecycle",
]);
const GOAL_RECORD_FIELDS = new Set(["goal_ref", "strategies"]);
const STRATEGY_FIELDS = new Set(["id", "identity", "working_state", "result_refs", "availability"]);
const STRATEGY_IDENTITY_FIELDS = new Set(["statement", "distinction"]);
const WORKING_STATE_FIELDS = new Set([
  "remaining_gap",
  "obligations",
  "resumption_guidance",
  "input_refs",
  "forbidden_drift",
]);
const AVAILABILITY_FIELDS = new Set(["state", "disposition", "reason"]);
const FOCUS_FIELDS = new Set(["route_ref", "goal_ref", "strategy_ref"]);
const REF_FIELDS = new Set(["kind", "id"]);
const MATH_REF_KINDS = new Set(["entry", "inference"]);
const STALE_REASON_ORDER = Object.freeze([
  "route_withdrawn",
  "goal_not_current",
  "goal_not_open",
  "strategy_retired",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonempty(value, label, code = "INVALID_ROUTE") {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(code, `${label} must be a non-empty exact string`);
  }
  return value;
}

function closed(value, fields, label, code) {
  for (const field of Object.keys(value)) {
    if (!fields.has(field)) fail(code, `${label} contains unknown field: ${field}`, { field });
  }
}

function required(value, fields, label, code) {
  for (const field of fields) {
    if (!(field in value)) fail(code, `${label} is missing field: ${field}`, { field });
  }
}

function refId(value, kind, label, code = "INVALID_ROUTE") {
  if (!plain(value)) fail(code, `${label} must be a ${kind} ref`);
  closed(value, REF_FIELDS, label, code);
  required(value, REF_FIELDS, label, code);
  if (value.kind !== kind) fail(code, `${label} must be a ${kind} ref`);
  return nonempty(value.id, `${label}.id`, code);
}

function refList(value, kind, label, code = "INVALID_ROUTE") {
  if (!Array.isArray(value)) fail(code, `${label} must be an array`);
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = refId(item, kind, `${label} item`, code);
    if (seen.has(id)) fail(code, `${label} contains duplicate ref: ${id}`);
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function stringList(value, label) {
  if (!Array.isArray(value)) fail("INVALID_ROUTE", `${label} must be an array`);
  const seen = new Set();
  for (const item of value) {
    nonempty(item, `${label} item`);
    if (seen.has(item)) fail("INVALID_ROUTE", `${label} contains a duplicate item`);
    seen.add(item);
  }
  return value;
}

function nullableNonempty(value, label) {
  if (value !== null) nonempty(value, label);
}

function validateMathRefList(value, label, context, { routeEntryIds = null, routeInferenceIds = null } = {}) {
  if (!Array.isArray(value)) fail("INVALID_ROUTE", `${label} must be an array`);
  const seen = new Set();
  for (const item of value) {
    if (!plain(item) || !MATH_REF_KINDS.has(item.kind)) {
      fail("INVALID_ROUTE", `${label} must contain Entry or Inference refs`);
    }
    const id = refId(item, item.kind, `${label} item`);
    const key = `${item.kind}:${id}`;
    if (seen.has(key)) fail("INVALID_ROUTE", `${label} contains a duplicate ref: ${key}`);
    seen.add(key);
    const exists = item.kind === "entry"
      ? context.entriesById.has(id)
      : context.inferencesById.has(id);
    if (!exists) fail("INVALID_ROUTE", `${label} references unknown mathematical object: ${id}`);
    if (routeEntryIds && item.kind === "entry" && !routeEntryIds.has(id)) {
      fail("INVALID_ROUTE", `${label} Entry is outside its Route Entry subgraph: ${id}`);
    }
    if (routeInferenceIds && item.kind === "inference" && !routeInferenceIds.has(id)) {
      fail("INVALID_ROUTE", `${label} Inference is outside its Route Inference subgraph: ${id}`);
    }
    if (item.kind === "inference" && routeEntryIds) {
      const inference = context.inferencesById.get(id);
      for (const endpointId of [...inference.premises, inference.conclusion]) {
        if (!routeEntryIds.has(endpointId)) {
          fail("INVALID_ROUTE", `${label} Inference ${id} endpoint is outside its Entry subgraph: ${endpointId}`);
        }
      }
    }
  }
}

function validateAvailability(value, label) {
  if (!plain(value)) fail("INVALID_ROUTE", `${label} must be an object`);
  closed(value, AVAILABILITY_FIELDS, label, "INVALID_ROUTE");
  required(value, new Set(["state"]), label, "INVALID_ROUTE");
  if (value.state === "available") {
    if (Object.keys(value).length !== 1) fail("INVALID_ROUTE", `${label} available state must contain only state`);
    return "available";
  }
  if (value.state !== "retired") fail("INVALID_ROUTE", `${label}.state must be available or retired`);
  required(value, new Set(["disposition", "reason"]), label, "INVALID_ROUTE");
  if (!(value.disposition === "exhausted" || value.disposition === "withdrawn")) {
    fail("INVALID_ROUTE", `${label}.disposition must be exhausted or withdrawn`);
  }
  nonempty(value.reason, `${label}.reason`);
  if (Object.keys(value).length !== 3) fail("INVALID_ROUTE", `${label} retired state must contain state, disposition, and reason`);
  return "retired";
}

function validateWorkingState(value, label, context) {
  if (!plain(value)) fail("INVALID_ROUTE", `${label} must be an object`);
  closed(value, WORKING_STATE_FIELDS, label, "INVALID_ROUTE");
  required(value, WORKING_STATE_FIELDS, label, "INVALID_ROUTE");
  nullableNonempty(value.remaining_gap, `${label}.remaining_gap`);
  stringList(value.obligations, `${label}.obligations`);
  nullableNonempty(value.resumption_guidance, `${label}.resumption_guidance`);
  validateMathRefList(value.input_refs, `${label}.input_refs`, context);
  stringList(value.forbidden_drift, `${label}.forbidden_drift`);
}

function validateStrategy(strategy, label, context, routeEntryIds, routeInferenceIds, strategyIds) {
  if (!plain(strategy)) fail("INVALID_ROUTE", `${label} must be an object`);
  closed(strategy, STRATEGY_FIELDS, label, "INVALID_ROUTE");
  required(strategy, STRATEGY_FIELDS, label, "INVALID_ROUTE");
  const id = nonempty(strategy.id, `${label}.id`);
  if (strategyIds.has(id)) fail("INVALID_ROUTE", `Route contains duplicate Strategy ID: ${id}`);
  strategyIds.add(id);

  if (!plain(strategy.identity)) fail("INVALID_ROUTE", `${label}.identity must be an object`);
  closed(strategy.identity, STRATEGY_IDENTITY_FIELDS, `${label}.identity`, "INVALID_ROUTE");
  required(strategy.identity, STRATEGY_IDENTITY_FIELDS, `${label}.identity`, "INVALID_ROUTE");
  nonempty(strategy.identity.statement, `${label}.identity.statement`);
  nonempty(strategy.identity.distinction, `${label}.identity.distinction`);

  validateWorkingState(strategy.working_state, `${label}.working_state`, context);
  validateMathRefList(strategy.result_refs, `${label}.result_refs`, context, { routeEntryIds, routeInferenceIds });
  return { id, availability: validateAvailability(strategy.availability, `${label}.availability`) };
}

function validateRoute(route, context) {
  if (!plain(route)) fail("INVALID_ROUTE", "Route must be an object");
  closed(route, ROUTE_FIELDS, `Route ${route.id ?? "<missing>"}`, "INVALID_ROUTE");
  required(route, ROUTE_FIELDS, `Route ${route.id ?? "<missing>"}`, "INVALID_ROUTE");
  const id = nonempty(route.id, "Route.id");

  if (!plain(route.strategic_identity)) fail("INVALID_ROUTE", `Route ${id}.strategic_identity must be an object`);
  closed(route.strategic_identity, STRATEGY_IDENTITY_FIELDS, `Route ${id}.strategic_identity`, "INVALID_ROUTE");
  required(route.strategic_identity, STRATEGY_IDENTITY_FIELDS, `Route ${id}.strategic_identity`, "INVALID_ROUTE");
  nonempty(route.strategic_identity.statement, `Route ${id}.strategic_identity.statement`);
  nonempty(route.strategic_identity.distinction, `Route ${id}.strategic_identity.distinction`);

  const entryIds = refList(route.entry_refs, "entry", `Route ${id}.entry_refs`);
  const entrySet = new Set(entryIds);
  for (const entryId of entryIds) {
    if (!context.entriesById.has(entryId)) fail("INVALID_ROUTE", `Route ${id} references unknown Entry: ${entryId}`);
  }

  const inferenceIds = refList(route.inference_refs, "inference", `Route ${id}.inference_refs`);
  const inferenceSet = new Set(inferenceIds);
  for (const inferenceId of inferenceIds) {
    const inference = context.inferencesById.get(inferenceId);
    if (!inference) fail("INVALID_ROUTE", `Route ${id} references unknown Inference: ${inferenceId}`);
    for (const endpointId of [...inference.premises, inference.conclusion]) {
      if (!entrySet.has(endpointId)) {
        fail("INVALID_ROUTE", `Route ${id} Inference ${inferenceId} endpoint is outside its Entry subgraph: ${endpointId}`);
      }
    }
  }

  const startIds = refList(route.start_entry_refs, "entry", `Route ${id}.start_entry_refs`);
  if (startIds.length === 0) fail("INVALID_ROUTE", `Route ${id} must have at least one start Entry`);
  const starts = new Set(startIds);
  for (const startId of startIds) {
    if (!entrySet.has(startId)) fail("INVALID_ROUTE", `Route ${id} start is outside its Entry subgraph: ${startId}`);
    const entry = context.entriesById.get(startId);
    const available = entry.entryClass === "fact" || context.mathState.claimStates[startId] === "established";
    if (!available) fail("INVALID_ROUTE", `Route ${id} start is not globally available: ${startId}`);
  }

  if (!Array.isArray(route.goal_records)) fail("INVALID_ROUTE", `Route ${id}.goal_records must be an array`);
  const goalIds = [];
  const goalSet = new Set();
  const strategyIds = new Set();
  const goalsById = new Map();
  for (const [goalIndex, goalRecord] of route.goal_records.entries()) {
    const goalLabel = `Route ${id}.goal_records[${goalIndex}]`;
    if (!plain(goalRecord)) fail("INVALID_ROUTE", `${goalLabel} must be an object`);
    closed(goalRecord, GOAL_RECORD_FIELDS, goalLabel, "INVALID_ROUTE");
    required(goalRecord, GOAL_RECORD_FIELDS, goalLabel, "INVALID_ROUTE");
    const goalId = refId(goalRecord.goal_ref, "entry", `${goalLabel}.goal_ref`);
    if (goalSet.has(goalId)) fail("INVALID_ROUTE", `Route ${id} contains duplicate Goal Record: ${goalId}`);
    goalSet.add(goalId);
    goalIds.push(goalId);
    if (!entrySet.has(goalId)) fail("INVALID_ROUTE", `Route ${id} goal is outside its Entry subgraph: ${goalId}`);
    if (context.entriesById.get(goalId)?.entryClass !== "claim") {
      fail("INVALID_ROUTE", `Route ${id} goal must be a Claim: ${goalId}`);
    }
    if (!Array.isArray(goalRecord.strategies)) fail("INVALID_ROUTE", `${goalLabel}.strategies must be an array`);
    const goalStrategyIds = [];
    const goalStrategies = new Map();
    for (const [strategyIndex, strategy] of goalRecord.strategies.entries()) {
      const strategyLabel = `${goalLabel}.strategies[${strategyIndex}]`;
      const validStrategy = validateStrategy(strategy, strategyLabel, context, entrySet, inferenceSet, strategyIds);
      goalStrategyIds.push(validStrategy.id);
      goalStrategies.set(validStrategy.id, {
        availability: validStrategy.availability,
        source: strategy,
      });
    }
    goalsById.set(goalId, { goalRecord, strategyIds: goalStrategyIds, strategies: goalStrategies });
  }

  const currentGoalIds = refList(route.current_goal_refs, "entry", `Route ${id}.current_goal_refs`);
  const currentGoalSet = new Set(currentGoalIds);
  for (const goalId of currentGoalIds) {
    if (!goalSet.has(goalId)) fail("INVALID_ROUTE", `Route ${id} current Goal is not a Goal Record: ${goalId}`);
    if (starts.has(goalId)) fail("INVALID_ROUTE", `Route ${id} start and current Goal must be distinct: ${goalId}`);
  }

  if (!plain(route.lifecycle)) fail("INVALID_ROUTE", `Route ${id}.lifecycle must be an object`);
  const lifecycleFields = new Set(["state", "reason"]);
  closed(route.lifecycle, lifecycleFields, `Route ${id}.lifecycle`, "INVALID_ROUTE");
  required(route.lifecycle, new Set(["state"]), `Route ${id}.lifecycle`, "INVALID_ROUTE");
  const lifecycle = route.lifecycle.state;
  if (lifecycle === "active") {
    if (Object.keys(route.lifecycle).length !== 1) fail("INVALID_ROUTE", `Route ${id}.active lifecycle must contain only state`);
  } else if (lifecycle === "withdrawn") {
    required(route.lifecycle, new Set(["reason"]), `Route ${id}.lifecycle`, "INVALID_ROUTE");
    nonempty(route.lifecycle.reason, `Route ${id}.lifecycle.reason`);
    if (Object.keys(route.lifecycle).length !== 2) fail("INVALID_ROUTE", `Route ${id}.withdrawn lifecycle must contain state and reason`);
  } else {
    fail("INVALID_ROUTE", `Route ${id}.lifecycle.state must be active or withdrawn`);
  }

  return {
    id,
    entryIds,
    inferenceIds,
    startIds,
    goalIds,
    currentGoalIds,
    currentGoalSet,
    lifecycle,
    goalsById,
  };
}

function validateFocus(focus, routeById, context) {
  if (!plain(focus)) fail("INVALID_FOCUS", "Focus must be null or an object");
  closed(focus, FOCUS_FIELDS, "Focus", "INVALID_FOCUS");
  required(focus, FOCUS_FIELDS, "Focus", "INVALID_FOCUS");
  const routeId = refId(focus.route_ref, "route", "Focus.route_ref", "INVALID_FOCUS");
  const goalId = refId(focus.goal_ref, "entry", "Focus.goal_ref", "INVALID_FOCUS");
  const strategyId = refId(focus.strategy_ref, "strategy", "Focus.strategy_ref", "INVALID_FOCUS");
  const route = routeById.get(routeId);
  if (!route) fail("INVALID_FOCUS", `Focus references unknown Route: ${routeId}`);
  const goal = route.goalsById.get(goalId);
  if (!goal) fail("INVALID_FOCUS", `Focus Goal does not belong to Route: ${goalId}`);
  if (!goal.strategies.has(strategyId)) {
    fail("INVALID_FOCUS", `Focus Strategy does not belong to Goal: ${strategyId}`);
  }
  if (!context.entriesById.has(goalId) || context.entriesById.get(goalId).entryClass !== "claim") {
    fail("INVALID_FOCUS", `Focus Goal must reference a Claim: ${goalId}`);
  }

  const reasons = [];
  if (route.lifecycle === "withdrawn") reasons.push("route_withdrawn");
  if (!route.currentGoalSet.has(goalId)) reasons.push("goal_not_current");
  if (context.mathState.claimStates[goalId] !== "open") reasons.push("goal_not_open");
  if (goal.strategies.get(strategyId).availability === "retired") reasons.push("strategy_retired");
  return { reasons };
}

function deriveRouteState(M, R) {
  const mathState = deriveMathState(M);
  if (!plain(R)) fail("INVALID_ROUTE_STATE", "R must be an object");
  closed(R, new Set(["routes", "focus"]), "R", "INVALID_ROUTE_STATE");
  required(R, new Set(["routes", "focus"]), "R", "INVALID_ROUTE_STATE");
  if (!Array.isArray(R.routes)) fail("INVALID_ROUTE_STATE", "R.routes must be an array");

  const context = {
    mathState,
    entriesById: new Map(M.entries.map((entry) => [entry.id, entry])),
    inferencesById: new Map(M.inferences.map((inference) => [inference.id, inference])),
  };
  const routes = [];
  const routeIds = new Set();
  const routeById = new Map();
  const routeProgressEntries = [];
  for (const route of R.routes) {
    const valid = validateRoute(route, context);
    if (routeIds.has(valid.id)) fail("INVALID_ROUTE_STATE", `Duplicate Route ID: ${valid.id}`);
    routeIds.add(valid.id);
    routeById.set(valid.id, valid);
    routes.push(structuredClone(route));

    const openGoalIds = valid.currentGoalIds.filter((id) => mathState.claimStates[id] === "open");
    const refutedGoalIds = valid.currentGoalIds.filter((id) => mathState.claimStates[id] === "refuted");
    const status = valid.lifecycle === "withdrawn"
      ? "withdrawn"
      : openGoalIds.length === 0 && refutedGoalIds.length === 0 ? "completed" : "active";
    routeProgressEntries.push([valid.id, {
      status,
      open_goal_ids: openGoalIds,
      refuted_goal_ids: refutedGoalIds,
    }]);
  }

  let focusStatus;
  if (R.focus === null) {
    focusStatus = { status: "none", reasons: [] };
  } else {
    const focusValidity = validateFocus(R.focus, routeById, context);
    const reasons = STALE_REASON_ORDER.filter((reason) => focusValidity.reasons.includes(reason));
    focusStatus = reasons.length === 0
      ? { status: "current", reasons: [] }
      : { status: "stale", reasons };
  }

  return {
    routes,
    focus: structuredClone(R.focus),
    focus_status: focusStatus,
    route_progress: Object.fromEntries(routeProgressEntries),
  };
}

module.exports = Object.freeze({ CAPABILITY_ID, deriveRouteState });

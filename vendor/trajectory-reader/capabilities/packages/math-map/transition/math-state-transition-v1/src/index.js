"use strict";

const { deriveMathState } = require("../../../state/math-graph-semantics-v3/src/index.js");

const CAPABILITY_ID = "cmath.math-state-transition/v1";

function clone(value) {
  return structuredClone(value);
}

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  throw error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      fail("INVALID_DELTA_M", `${label} contains unknown field: ${field}`, { field });
    }
  }
}

function validateDeltaShape(deltaM) {
  if (!isPlainObject(deltaM)) fail("INVALID_DELTA_M", "Delta M must be an object");
  if (deltaM.operation === "no_change") {
    rejectUnknownFields(deltaM, new Set(["operation"]), "no_change delta");
    return { operation: "no_change" };
  }
  if (deltaM.operation !== "append") {
    fail("INVALID_DELTA_M", `Delta M has unsupported operation: ${deltaM.operation}`);
  }
  rejectUnknownFields(deltaM, new Set(["operation", "actions"]), "append delta");
  if (!Array.isArray(deltaM.actions) || deltaM.actions.length === 0) {
    fail("INVALID_DELTA_M", "append delta must contain a non-empty actions array");
  }
  return { operation: "append", actions: deltaM.actions };
}

function validateAddEntryAction(action) {
  rejectUnknownFields(action, new Set(["operation", "entry"]), "add_entry action");
  if (!isPlainObject(action.entry)) fail("INVALID_DELTA_M", "add_entry action.entry must be an object");
}

function validateEntryWithV3(entry) {
  deriveMathState({
    entries: [entry],
    inferences: [],
    negationPairs: [],
    b0ClaimEntryIds: [],
  });
}

function validateAddInferenceAction(action) {
  rejectUnknownFields(action, new Set(["operation", "inference"]), "add_inference action");
  if (!isPlainObject(action.inference)) {
    fail("INVALID_DELTA_M", "add_inference action.inference must be an object");
  }
}

function validateAddNegationPairAction(action) {
  rejectUnknownFields(action, new Set(["operation", "negation_pair"]), "add_negation_pair action");
  if (!isPlainObject(action.negation_pair)) {
    fail("INVALID_DELTA_M", "add_negation_pair action.negation_pair must be an object");
  }
}

function validateAddB0ClaimAction(action) {
  rejectUnknownFields(action, new Set(["operation", "claim_entry_id"]), "add_b0_claim action");
  if (typeof action.claim_entry_id !== "string") {
    fail("INVALID_DELTA_M", "add_b0_claim action.claim_entry_id must be a string");
  }
}

function potentialId(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function pairKey(left, right) {
  return JSON.stringify([left, right].sort());
}

function validateActionShape(action) {
  if (!isPlainObject(action)) fail("INVALID_DELTA_M", "append action must be an object");
  if (action.operation === "add_entry") {
    validateAddEntryAction(action);
    return;
  }
  if (action.operation === "add_inference") {
    validateAddInferenceAction(action);
    return;
  }
  if (action.operation === "add_negation_pair") {
    validateAddNegationPairAction(action);
    return;
  }
  if (action.operation === "add_b0_claim") {
    validateAddB0ClaimAction(action);
    return;
  }
  fail("INVALID_DELTA_M", `append action has unsupported operation: ${action.operation}`);
}

function referenceIds(inference) {
  return [...(Array.isArray(inference.premises) ? inference.premises : []), inference.conclusion];
}

function checkReferenceOrdering(id, index, futureEntryIndexes) {
  if (typeof id !== "string") return;
  const entryIndex = futureEntryIndexes.get(id);
  if (entryIndex !== undefined && entryIndex > index) {
    fail("INVALID_DELTA_M", `Action ${index} references an Entry added later at action ${entryIndex}: ${id}`, {
      actionIndex: index,
      referencedActionIndex: entryIndex,
      referenceId: id,
    });
  }
}

function validateAppendConflicts(M, actions) {
  for (const action of actions) validateActionShape(action);

  const existingIds = new Set([
    ...M.entries.map((entry) => entry.id),
    ...M.inferences.map((inference) => inference.id),
  ]);
  const availableClaimIds = new Set(
    M.entries.filter((entry) => entry.entryClass === "claim").map((entry) => entry.id),
  );
  const futureEntryIndexes = new Map();
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    if (action.operation !== "add_entry") continue;
    const id = action.entry.id;
    if (!potentialId(id)) continue;
    if (!futureEntryIndexes.has(id)) futureEntryIndexes.set(id, index);
  }

  const pendingIds = new Set();
  const pendingPairKeys = new Set();
  const pairedClaimIds = new Set();
  for (const pair of M.negationPairs) {
    const [left, right] = pair.claimEntryIds;
    pairedClaimIds.add(left);
    pairedClaimIds.add(right);
  }
  const pendingB0Ids = new Set();

  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];

    if (action.operation === "add_entry") {
      validateEntryWithV3(action.entry);
      const id = action.entry.id;
      if (potentialId(id) && (existingIds.has(id) || pendingIds.has(id))) {
        fail("DELTA_M_CONFLICT", `Delta M adds an already-used semantic ID: ${id}`, { id, actionIndex: index });
      }
      if (potentialId(id)) {
        pendingIds.add(id);
        if (action.entry.entryClass === "claim") availableClaimIds.add(id);
      }
      continue;
    }

    if (action.operation === "add_inference") {
      const inference = action.inference;
      const id = inference.id;
      if (potentialId(id) && (existingIds.has(id) || pendingIds.has(id))) {
        fail("DELTA_M_CONFLICT", `Delta M adds an already-used semantic ID: ${id}`, { id, actionIndex: index });
      }
      for (const referenceId of referenceIds(inference)) {
        checkReferenceOrdering(referenceId, index, futureEntryIndexes);
      }
      if (potentialId(id)) pendingIds.add(id);
      continue;
    }

    if (action.operation === "add_negation_pair") {
      const pair = action.negation_pair;
      if (Array.isArray(pair.claimEntryIds) && pair.claimEntryIds.length === 2) {
        const [left, right] = pair.claimEntryIds;
        checkReferenceOrdering(left, index, futureEntryIndexes);
        checkReferenceOrdering(right, index, futureEntryIndexes);
        if (potentialId(left) && potentialId(right) && left !== right) {
          const key = pairKey(left, right);
          const knownClaimEndpoints = availableClaimIds.has(left) && availableClaimIds.has(right);
          if (knownClaimEndpoints && (M.negationPairs.some((existingPair) => pairKey(...existingPair.claimEntryIds) === key)
            || pendingPairKeys.has(key)
            || pairedClaimIds.has(left)
            || pairedClaimIds.has(right))) {
            fail("DELTA_M_CONFLICT", `Delta M conflicts with an existing NegationPair: ${left}, ${right}`, {
              actionIndex: index,
              claimEntryIds: [left, right],
            });
          }
          pendingPairKeys.add(key);
          pairedClaimIds.add(left);
          pairedClaimIds.add(right);
        }
      }
      continue;
    }

    const claimId = action.claim_entry_id;
    checkReferenceOrdering(claimId, index, futureEntryIndexes);
    if (potentialId(claimId) && (M.b0ClaimEntryIds.includes(claimId) || pendingB0Ids.has(claimId))) {
      fail("DELTA_M_CONFLICT", `Delta M adds a duplicate B0 Claim: ${claimId}`, {
        actionIndex: index,
        claimEntryId: claimId,
      });
    }
    if (potentialId(claimId)) pendingB0Ids.add(claimId);
  }
}

function transitionMathState(M, deltaM) {
  const mathState = deriveMathState(M);
  const delta = validateDeltaShape(deltaM);
  if (delta.operation === "no_change") {
    return {
      next_m: clone(M),
      accepted_delta_m: delta,
      math_state: clone(mathState),
    };
  }

  validateAppendConflicts(M, delta.actions);
  const nextM = {
    entries: [...M.entries],
    inferences: [...M.inferences],
    negationPairs: [...M.negationPairs],
    b0ClaimEntryIds: [...M.b0ClaimEntryIds],
  };
  for (const action of delta.actions) {
    if (action.operation === "add_entry") {
      nextM.entries.push(action.entry);
      continue;
    }
    if (action.operation === "add_inference") {
      nextM.inferences.push(action.inference);
      continue;
    }
    if (action.operation === "add_negation_pair") {
      nextM.negationPairs.push(action.negation_pair);
      continue;
    }
    if (action.operation === "add_b0_claim") {
      nextM.b0ClaimEntryIds.push(action.claim_entry_id);
      continue;
    }
  }

  const nextMathState = deriveMathState(nextM);
  return {
    next_m: clone(nextM),
    accepted_delta_m: clone(delta),
    math_state: clone(nextMathState),
  };
}

module.exports = Object.freeze({ CAPABILITY_ID, transitionMathState });

"use strict";

const CAPABILITY_ID = "cmath-gamma.math-map-semantics/v3";
const STATE_CONTRACT = "cmath.math-map-state/v3";
const STATE_FIELDS = new Set(["entries", "inferences", "negationPairs", "b0ClaimEntryIds"]);
const ENTRY_CLASSES = Object.freeze(["fact", "claim"]);
const FACT_KINDS = Object.freeze(["definition", "algorithm", "calculation"]);
const CLAIM_KINDS = Object.freeze(["lemma", "proposition", "theorem"]);
const INFERENCE_KINDS = Object.freeze(["proof", "organization"]);
const entryClasses = new Set(ENTRY_CLASSES);
const factKinds = new Set(FACT_KINDS);
const claimKinds = new Set(CLAIM_KINDS);
const inferenceKinds = new Set(INFERENCE_KINDS);
const INFERENCE_FIELDS = new Set(["id", "operationKind", "premises", "conclusion", "argument"]);
const NEGATION_PAIR_FIELDS = new Set(["claimEntryIds"]);

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
    if (!allowed.has(field)) fail("UNKNOWN_FIELD", `${label} contains unknown field: ${field}`, { field });
  }
}

function exactNonemptyString(value, label, code) {
  if (typeof value !== "string" || !value || value !== value.trim()) {
    fail(code, `${label} must be a non-empty string without surrounding whitespace`);
  }
  return value;
}

function computeProofClosure(factIds, seedClaimIds, proofs) {
  const availableFacts = new Set(factIds);
  const established = new Set(seedClaimIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const proof of proofs) {
      if (established.has(proof.conclusion)) continue;
      if (proof.premises.every((id) => availableFacts.has(id) || established.has(id))) {
        established.add(proof.conclusion);
        changed = true;
      }
    }
  }
  return established;
}

function validateEntry(entry, ids, byId) {
  if (!isPlainObject(entry)) fail("INVALID_ENTRY", "Entry must be an object");
  const role = entry.entryClass;
  if (!entryClasses.has(role)) fail("INVALID_ENTRY", `Entry has unsupported entryClass: ${role}`);
  const allowed = role === "fact"
    ? new Set(["id", "entryClass", "factKind", "title", "statement"])
    : new Set(["id", "entryClass", "claimKind", "title", "statement"]);
  rejectUnknownFields(entry, allowed, `Entry ${entry.id ?? "<missing>"}`);
  const id = exactNonemptyString(entry.id, "Entry.id", "INVALID_ENTRY");
  if (ids.has(id)) fail("DUPLICATE_ID", `Duplicate semantic ID: ${id}`, { id });
  exactNonemptyString(entry.title, `Entry ${id}.title`, "INVALID_ENTRY");
  exactNonemptyString(entry.statement, `Entry ${id}.statement`, "INVALID_ENTRY");
  if (role === "fact" && !factKinds.has(entry.factKind)) {
    fail("INVALID_ENTRY", `Fact ${id} has unsupported factKind: ${entry.factKind}`);
  }
  if (role === "claim" && !claimKinds.has(entry.claimKind)) {
    fail("INVALID_ENTRY", `Claim ${id} has unsupported claimKind: ${entry.claimKind}`);
  }
  ids.add(id);
  byId.set(id, entry);
}

function validateInference(inference, ids, byId) {
  if (!isPlainObject(inference)) fail("INVALID_INFERENCE", "Inference must be an object");
  rejectUnknownFields(inference, INFERENCE_FIELDS, `Inference ${inference.id ?? "<missing>"}`);
  const id = exactNonemptyString(inference.id, "Inference.id", "INVALID_INFERENCE");
  if (ids.has(id)) fail("DUPLICATE_ID", `Duplicate semantic ID: ${id}`, { id });
  if (!inferenceKinds.has(inference.operationKind)) {
    fail("INVALID_INFERENCE", `Inference ${id} has unsupported operationKind: ${inference.operationKind}`);
  }
  if (!Array.isArray(inference.premises) || inference.premises.length === 0) {
    fail("INVALID_INFERENCE", `Inference ${id} must have at least one premise`);
  }
  const premiseIds = new Set();
  for (const premiseId of inference.premises) {
    exactNonemptyString(premiseId, `Inference ${id} premise`, "INVALID_INFERENCE");
    if (premiseIds.has(premiseId)) fail("INVALID_INFERENCE", `Inference ${id} contains duplicate premise: ${premiseId}`);
    premiseIds.add(premiseId);
    if (!byId.has(premiseId)) fail("UNKNOWN_REFERENCE", `Inference ${id} has unknown premise: ${premiseId}`);
  }
  const conclusionId = exactNonemptyString(inference.conclusion, `Inference ${id}.conclusion`, "INVALID_INFERENCE");
  const conclusion = byId.get(conclusionId);
  if (!conclusion) fail("UNKNOWN_REFERENCE", `Inference ${id} has unknown conclusion: ${conclusionId}`);
  exactNonemptyString(inference.argument, `Inference ${id}.argument`, "INVALID_INFERENCE");
  if (inference.operationKind === "proof" && conclusion.entryClass !== "claim") {
    fail("INVALID_INFERENCE", `proof ${id} must conclude a Claim`);
  }
  if (inference.operationKind === "organization" && (conclusion.entryClass !== "fact" || conclusion.factKind !== "definition")) {
    fail("INVALID_INFERENCE", `organization ${id} must conclude a Fact(definition)`);
  }
  ids.add(id);
}

function rejectOrganizationCycles(inferences) {
  const adjacency = new Map();
  for (const inference of inferences) {
    if (inference.operationKind !== "organization") continue;
    for (const premiseId of inference.premises) {
      const targets = adjacency.get(premiseId) ?? [];
      targets.push(inference.conclusion);
      adjacency.set(premiseId, targets);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) fail("ORGANIZATION_CYCLE", `organization cycle includes Entry: ${id}`, { id });
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of adjacency.keys()) visit(id);
}

function validateNegationPairs(negationPairs, byId) {
  const seenPairs = new Set();
  const pairedClaims = new Set();
  const negationByClaimId = new Map();
  for (const pair of negationPairs) {
    if (!isPlainObject(pair)) fail("INVALID_NEGATION_PAIR", "NegationPair must be an object");
    rejectUnknownFields(pair, NEGATION_PAIR_FIELDS, "NegationPair");
    if (!Array.isArray(pair.claimEntryIds) || pair.claimEntryIds.length !== 2) {
      fail("INVALID_NEGATION_PAIR", "NegationPair.claimEntryIds must contain exactly two Claim IDs");
    }
    const [left, right] = pair.claimEntryIds;
    exactNonemptyString(left, "NegationPair left Claim ID", "INVALID_NEGATION_PAIR");
    exactNonemptyString(right, "NegationPair right Claim ID", "INVALID_NEGATION_PAIR");
    if (left === right) fail("INVALID_NEGATION_PAIR", "NegationPair endpoints must be distinct Claims");
    for (const claimId of [left, right]) {
      if (byId.get(claimId)?.entryClass !== "claim") {
        fail("INVALID_NEGATION_PAIR", `NegationPair endpoint must reference a Claim: ${claimId}`);
      }
      if (pairedClaims.has(claimId)) {
        fail("INVALID_NEGATION_PAIR", `Claim belongs to more than one NegationPair: ${claimId}`);
      }
    }
    const key = JSON.stringify([left, right].sort());
    if (seenPairs.has(key)) fail("INVALID_NEGATION_PAIR", `Duplicate NegationPair: ${left}, ${right}`);
    seenPairs.add(key);
    pairedClaims.add(left);
    pairedClaims.add(right);
    negationByClaimId.set(left, { other: right, pair: [left, right] });
    negationByClaimId.set(right, { other: left, pair: [left, right] });
  }
  return negationByClaimId;
}

function validateMathState(model) {
  if (!isPlainObject(model)) fail("INVALID_STATE_SHAPE", "Math State must be an object");
  rejectUnknownFields(model, STATE_FIELDS, "Math State");
  for (const field of STATE_FIELDS) {
    if (!Array.isArray(model[field])) fail("INVALID_STATE_SHAPE", `Math State.${field} must be an array`);
  }
  const ids = new Set();
  const byId = new Map();
  for (const entry of model.entries) validateEntry(entry, ids, byId);
  for (const inference of model.inferences) validateInference(inference, ids, byId);
  rejectOrganizationCycles(model.inferences);
  const negationByClaimId = validateNegationPairs(model.negationPairs, byId);
  const b0Ids = new Set();
  for (const claimId of model.b0ClaimEntryIds) {
    exactNonemptyString(claimId, "B0 Claim ID", "INVALID_B0");
    if (b0Ids.has(claimId)) fail("INVALID_B0", `B0 contains duplicate Claim: ${claimId}`);
    if (byId.get(claimId)?.entryClass !== "claim") fail("INVALID_B0", `B0 must reference a Claim: ${claimId}`);
    b0Ids.add(claimId);
  }
  const factIds = new Set(model.entries.filter((entry) => entry.entryClass === "fact").map((entry) => entry.id));
  const proofs = model.inferences.filter((item) => item.operationKind === "proof");
  for (const claimId of model.b0ClaimEntryIds) {
    const independentlyEstablished = computeProofClosure(
      factIds,
      model.b0ClaimEntryIds.filter((id) => id !== claimId),
      proofs,
    );
    if (independentlyEstablished.has(claimId)) {
      fail("INVALID_B0", `B0 Claim is independently proved inside M: ${claimId}`);
    }
  }
  return { negationByClaimId };
}

function deriveMathState(model) {
  const { negationByClaimId } = validateMathState(model);
  const facts = model.entries.filter((entry) => entry.entryClass === "fact");
  const claims = model.entries.filter((entry) => entry.entryClass === "claim");
  const availableFactIds = facts.map((entry) => entry.id);
  const availableFacts = new Set(availableFactIds);
  const proofs = model.inferences.filter((inference) => inference.operationKind === "proof");
  const established = computeProofClosure(availableFactIds, model.b0ClaimEntryIds, proofs);

  for (const pair of model.negationPairs) {
    const [left, right] = pair.claimEntryIds;
    if (established.has(left) && established.has(right)) {
      fail("CONTRADICTORY_CLOSURE", `Negation Pair endpoints cannot both enter Closure: ${left}, ${right}`, {
        claimEntryIds: [left, right],
      });
    }
  }

  const closureClaimEntryIds = claims.filter((entry) => established.has(entry.id)).map((entry) => entry.id);
  const claimStateEntries = [];
  const claimDerivationEntries = [];

  for (const claim of claims) {
    const negation = negationByClaimId.get(claim.id);
    if (established.has(claim.id)) {
      claimStateEntries.push([claim.id, "established"]);
      claimDerivationEntries.push([claim.id, model.b0ClaimEntryIds.includes(claim.id)
        ? { basis: "b0" }
        : {
            basis: "proof",
            establishingProofIds: proofs
              .filter((proof) => proof.conclusion === claim.id)
              .filter((proof) => proof.premises.every((id) => availableFacts.has(id) || established.has(id)))
              .map((proof) => proof.id),
          }]);
      continue;
    }
    if (negation && established.has(negation.other)) {
      claimStateEntries.push([claim.id, "refuted"]);
      claimDerivationEntries.push([claim.id, {
        basis: "negation",
        negatingClaimEntryId: negation.other,
        negationPairClaimEntryIds: [...negation.pair],
      }]);
      continue;
    }
    claimStateEntries.push([claim.id, "open"]);
    const candidateProofs = proofs.filter((proof) => proof.conclusion === claim.id);
    claimDerivationEntries.push([claim.id, candidateProofs.length
      ? {
          basis: "open",
          blockedProofs: candidateProofs.map((proof) => ({
            proofId: proof.id,
            missingPremiseIds: proof.premises.filter((id) => !availableFacts.has(id) && !established.has(id)),
          })),
        }
      : { basis: "open", reason: "no_proof" }]);
  }

  return {
    availableFactIds,
    b0ClaimEntryIds: [...model.b0ClaimEntryIds],
    closureClaimEntryIds,
    claimStates: Object.fromEntries(claimStateEntries),
    claimDerivations: Object.fromEntries(claimDerivationEntries),
  };
}

const capability = Object.freeze({
  CAPABILITY_ID,
  STATE_CONTRACT,
  ENTRY_CLASSES,
  FACT_KINDS,
  CLAIM_KINDS,
  INFERENCE_KINDS,
  deriveMathState,
});
if (typeof module === "object" && module.exports) module.exports = capability;
if (typeof globalThis === "object") globalThis.GammaMathMapSemantics = capability;

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PROOF_STATE_SCHEMA = "run-math/proof-state-v1";
export const ROUTE_DECISION_SCHEMA = "run-math/route-decision-v1";

const KNOWLEDGE_STATUSES = ["known", "open", "conditional", "disputed", "unchecked"];
const OBLIGATION_STATUSES = ["open", "candidate", "closed", "refuted", "blocked", "superseded"];
const OBLIGATION_RELATION_KINDS = ["root", "lemma", "equivalent", "necessary_condition", "special_case", "counterexample", "bridge", "audit"];
const RESULT_STATUSES = ["accepted", "conditional", "invalidated", "superseded"];
const ROUTE_STATUSES = ["active", "blocked", "refuted", "superseded", "paused"];
const ROUTE_ROLES = [
  "prove",
  "adversarial_review",
  "alternative_route",
  "premise_audit",
  "finite_certificate",
  "counterexample_search",
  "literature_boundary",
];
const PROGRESS_EFFECTS = [
  "close",
  "reduce",
  "split",
  "refute_route",
  "verify_premise",
  "identify_missing_hypothesis",
  "construct_certificate",
  "audit_dependency",
  "reproduce_known",
];
const PREMISE_MODES = ["accepted_only", "conditional_exploration"];
const ACTIONS = ["dispatch", "ask_user", "stop"];
const STOP_REASONS = ["root_completed", "budget_exhausted", "blocked", "no_viable_route", "user_stop"];

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

function makeResult(errors) {
  return { valid: errors.length === 0, ok: errors.length === 0, errors };
}

function createContext() {
  const errors = [];
  return {
    errors,
    add(code, message, path) {
      errors.push({ code, message, path });
    },
  };
}

function requireObject(value, path, context, code, message) {
  if (!isRecord(value)) {
    context.add(code, message, path);
    return null;
  }
  return value;
}

function requireString(container, key, path, context, code, message) {
  if (!hasOwn(container, key) || !isNonEmptyString(container[key])) {
    context.add(code, message, path);
    return null;
  }
  return container[key];
}

function requireStringValue(container, key, path, context, code, message) {
  if (!hasOwn(container, key) || typeof container[key] !== "string") {
    context.add(code, message, path);
    return null;
  }
  return container[key];
}

function requireArray(container, key, path, context, code, message) {
  if (!hasOwn(container, key) || !Array.isArray(container[key])) {
    context.add(code, message, path);
    return null;
  }
  return container[key];
}

function requireEnum(container, key, values, path, context, code, message) {
  if (!hasOwn(container, key) || !values.includes(container[key])) {
    context.add(code, message, path);
    return null;
  }
  return container[key];
}

function validateStringArray(values, path, context, code, message) {
  if (!Array.isArray(values)) return;
  values.forEach((value, index) => {
    if (!isNonEmptyString(value)) context.add(code, message, `${path}[${index}]`);
  });
}

function addDuplicateId(context, seen, id, path, code, label) {
  if (!isNonEmptyString(id)) return;
  if (seen.has(id)) {
    context.add(code, `${label} id must be unique.`, path);
  } else {
    seen.add(id);
  }
}

function collectProofState(proofState, context) {
  const data = {
    rootTarget: null,
    rootTargetId: null,
    obligationById: new Map(),
    rootObligation: null,
    acceptedResultById: new Map(),
    routeById: new Map(),
    declaredFingerprint: null,
    routes: [],
  };

  if (!isRecord(proofState)) {
    context.add("PROOF_STATE_NOT_OBJECT", "proofState must be an object.", "proofState");
    return data;
  }

  if (proofState.schema !== PROOF_STATE_SCHEMA) {
    context.add("PROOF_STATE_SCHEMA_INVALID", `proofState.schema must be ${PROOF_STATE_SCHEMA}.`, "proofState.schema");
  }
  const targetId = requireString(
    proofState,
    "targetId",
    "proofState.targetId",
    context,
    "PROOF_STATE_TARGET_ID_INVALID",
    "proofState.targetId must be a non-empty string.",
  );

  const rootTarget = requireObject(
    proofState.rootTarget,
    "proofState.rootTarget",
    context,
    "ROOT_TARGET_INVALID",
    "proofState.rootTarget must be an object.",
  );
  data.rootTarget = rootTarget;
  if (rootTarget) {
    data.rootTargetId = requireString(
      rootTarget,
      "id",
      "proofState.rootTarget.id",
      context,
      "ROOT_TARGET_ID_INVALID",
      "proofState.rootTarget.id must be a non-empty string.",
    );
    requireString(
      rootTarget,
      "statement",
      "proofState.rootTarget.statement",
      context,
      "ROOT_TARGET_STATEMENT_INVALID",
      "proofState.rootTarget.statement must be a non-empty string.",
    );
    requireStringValue(
      rootTarget,
      "scope",
      "proofState.rootTarget.scope",
      context,
      "ROOT_TARGET_SCOPE_MISSING",
      "proofState.rootTarget.scope must be a string.",
    );
    requireStringValue(
      rootTarget,
      "normalizationBoundary",
      "proofState.rootTarget.normalizationBoundary",
      context,
      "ROOT_TARGET_NORMALIZATION_BOUNDARY_MISSING",
      "proofState.rootTarget.normalizationBoundary must be a string.",
    );
    requireString(
      rootTarget,
      "verbatimUserGoal",
      "proofState.rootTarget.verbatimUserGoal",
      context,
      "ROOT_TARGET_VERBATIM_GOAL_INVALID",
      "proofState.rootTarget.verbatimUserGoal must be a non-empty string.",
    );
    requireString(
      rootTarget,
      "sourceRequestRef",
      "proofState.rootTarget.sourceRequestRef",
      context,
      "ROOT_TARGET_SOURCE_REQUEST_REF_INVALID",
      "proofState.rootTarget.sourceRequestRef must be a non-empty string.",
    );
    requireString(
      rootTarget,
      "fingerprint",
      "proofState.rootTarget.fingerprint",
      context,
      "ROOT_TARGET_FINGERPRINT_INVALID",
      "proofState.rootTarget.fingerprint must be a non-empty string.",
    );
  }

  const activeContractFingerprint = requireString(
    proofState,
    "activeContractFingerprint",
    "proofState.activeContractFingerprint",
    context,
    "ACTIVE_CONTRACT_FINGERPRINT_INVALID",
    "proofState.activeContractFingerprint must be a non-empty string.",
  );

  const declaredFingerprint = requireString(
    proofState,
    "fingerprint",
    "proofState.fingerprint",
    context,
    "PROOF_STATE_FINGERPRINT_INVALID",
    "proofState.fingerprint must be a non-empty string.",
  );

  const revisions = requireArray(
    proofState,
    "contractRevisions",
    "proofState.contractRevisions",
    context,
    "CONTRACT_REVISIONS_INVALID",
    "proofState.contractRevisions must be an array.",
  );
  if (revisions) {
    const revisionIds = new Set();
    revisions.forEach((revision, index) => {
      const path = `proofState.contractRevisions[${index}]`;
      const item = requireObject(
        revision,
        path,
        context,
        "CONTRACT_REVISION_INVALID",
        "Each contract revision must be an object.",
      );
      if (!item) return;
      const revisionId = requireString(
        item,
        "revisionId",
        `${path}.revisionId`,
        context,
        "CONTRACT_REVISION_ID_INVALID",
        "contract revision revisionId must be a non-empty string.",
      );
      addDuplicateId(context, revisionIds, revisionId, `${path}.revisionId`, "DUPLICATE_CONTRACT_REVISION_ID", "Contract revision");
      requireString(
        item,
        "grillingEvidence",
        `${path}.grillingEvidence`,
        context,
        "CONTRACT_REVISION_GRILLING_EVIDENCE_INVALID",
        "A contract revision must include non-empty grillingEvidence.",
      );
      requireString(
        item,
        "approvedAt",
        `${path}.approvedAt`,
        context,
        "CONTRACT_REVISION_APPROVED_AT_INVALID",
        "contract revision approvedAt must be a non-empty string.",
      );
      requireString(
        item,
        "newContractFingerprint",
        `${path}.newContractFingerprint`,
        context,
        "CONTRACT_REVISION_FINGERPRINT_INVALID",
        "contract revision newContractFingerprint must be a non-empty string.",
      );
    });

    if (revisions.length > 0 && activeContractFingerprint && rootTarget) {
      const last = revisions[revisions.length - 1];
      if (isRecord(last) && isNonEmptyString(last.newContractFingerprint) && activeContractFingerprint !== last.newContractFingerprint) {
        context.add(
          "ACTIVE_CONTRACT_FINGERPRINT_STALE",
          "activeContractFingerprint must equal the last contract revision newContractFingerprint.",
          "proofState.activeContractFingerprint",
        );
      }
    }
    if (revisions.length === 0 && activeContractFingerprint && rootTarget && isNonEmptyString(rootTarget.fingerprint)) {
      if (activeContractFingerprint !== rootTarget.fingerprint) {
        context.add(
          "ACTIVE_CONTRACT_FINGERPRINT_WITHOUT_GRILLING",
          "activeContractFingerprint must equal rootTarget.fingerprint when contractRevisions is empty.",
          "proofState.activeContractFingerprint",
        );
      }
    }
  }

  const knowledgeBoundary = requireObject(
    proofState.knowledgeBoundary,
    "proofState.knowledgeBoundary",
    context,
    "KNOWLEDGE_BOUNDARY_INVALID",
    "proofState.knowledgeBoundary must be an object.",
  );
  if (knowledgeBoundary) {
    requireEnum(
      knowledgeBoundary,
      "knowledgeStatus",
      KNOWLEDGE_STATUSES,
      "proofState.knowledgeBoundary.knowledgeStatus",
      context,
      "KNOWLEDGE_STATUS_INVALID",
      "knowledgeBoundary.knowledgeStatus is invalid.",
    );
    requireStringValue(
      knowledgeBoundary,
      "knownResultsBoundary",
      "proofState.knowledgeBoundary.knownResultsBoundary",
      context,
      "KNOWN_RESULTS_BOUNDARY_MISSING",
      "knowledgeBoundary.knownResultsBoundary must be a string.",
    );
    const sourceRefs = requireArray(
      knowledgeBoundary,
      "sourceRefs",
      "proofState.knowledgeBoundary.sourceRefs",
      context,
      "KNOWLEDGE_SOURCE_REFS_INVALID",
      "knowledgeBoundary.sourceRefs must be an array.",
    );
    if (sourceRefs) {
      validateStringArray(
        sourceRefs,
        "proofState.knowledgeBoundary.sourceRefs",
        context,
        "KNOWLEDGE_SOURCE_REF_INVALID",
        "Each knowledgeBoundary.sourceRefs item must be a non-empty string.",
      );
    }
    requireString(
      knowledgeBoundary,
      "routeImplication",
      "proofState.knowledgeBoundary.routeImplication",
      context,
      "KNOWLEDGE_ROUTE_IMPLICATION_MISSING",
      "knowledgeBoundary.routeImplication must be a non-empty string.",
    );
  }

  const obligations = requireArray(
    proofState,
    "obligations",
    "proofState.obligations",
    context,
    "OBLIGATIONS_INVALID",
    "proofState.obligations must be an array.",
  );
  if (obligations) {
    obligations.forEach((obligation, index) => {
      const path = `proofState.obligations[${index}]`;
      const item = requireObject(
        obligation,
        path,
        context,
        "OBLIGATION_INVALID",
        "Each obligation must be an object.",
      );
      if (!item) return;
      const id = requireString(
        item,
        "id",
        `${path}.id`,
        context,
        "OBLIGATION_ID_INVALID",
        "obligation.id must be a non-empty string.",
      );
      if (isNonEmptyString(id)) {
        if (data.obligationById.has(id)) {
          context.add("DUPLICATE_OBLIGATION_ID", "Obligation id must be unique.", `${path}.id`);
        } else {
          data.obligationById.set(id, item);
        }
      }
      requireString(
        item,
        "statement",
        `${path}.statement`,
        context,
        "OBLIGATION_STATEMENT_INVALID",
        "obligation.statement must be a non-empty string.",
      );
      requireEnum(
        item,
        "relationKind",
        OBLIGATION_RELATION_KINDS,
        `${path}.relationKind`,
        context,
        "OBLIGATION_RELATION_KIND_INVALID",
        "obligation.relationKind is invalid.",
      );
      requireString(
        item,
        "relationToRoot",
        `${path}.relationToRoot`,
        context,
        "OBLIGATION_RELATION_MISSING",
        "obligation.relationToRoot must be a non-empty string.",
      );
      const dependencies = requireArray(
        item,
        "dependencies",
        `${path}.dependencies`,
        context,
        "OBLIGATION_DEPENDENCIES_INVALID",
        "obligation.dependencies must be an array.",
      );
      if (dependencies) {
        validateStringArray(
          dependencies,
          `${path}.dependencies`,
          context,
          "OBLIGATION_DEPENDENCY_ID_INVALID",
          "Each obligation dependency must be a non-empty string.",
        );
      }
      requireEnum(
        item,
        "status",
        OBLIGATION_STATUSES,
        `${path}.status`,
        context,
        "OBLIGATION_STATUS_INVALID",
        "obligation.status is invalid.",
      );
      const supportRefs = requireArray(
        item,
        "supportRefs",
        `${path}.supportRefs`,
        context,
        "OBLIGATION_SUPPORT_REFS_INVALID",
        "obligation.supportRefs must be an array.",
      );
      if (supportRefs) {
        validateStringArray(
          supportRefs,
          `${path}.supportRefs`,
          context,
          "OBLIGATION_SUPPORT_REF_INVALID",
          "Each obligation supportRef must be a non-empty string.",
        );
      }
      requireStringValue(
        item,
        "currentGap",
        `${path}.currentGap`,
        context,
        "OBLIGATION_CURRENT_GAP_MISSING",
        "obligation.currentGap must be a string.",
      );
    });

    for (const [id, obligation] of data.obligationById) {
      const dependencies = Array.isArray(obligation.dependencies) ? obligation.dependencies : [];
      dependencies.forEach((dependency, dependencyIndex) => {
        if (isNonEmptyString(dependency) && !data.obligationById.has(dependency)) {
          const obligationIndex = obligations.indexOf(obligation);
          context.add(
            "OBLIGATION_DEPENDENCY_UNKNOWN",
            `obligation dependency ${dependency} must reference an existing obligation.`,
            `proofState.obligations[${obligationIndex}].dependencies[${dependencyIndex}]`,
          );
        }
      });
      void id;
    }
  }

  if (data.rootTargetId && !data.obligationById.has(data.rootTargetId)) {
    context.add(
      "ROOT_OBLIGATION_MISSING",
      "rootTarget.id must correspond to an obligation id.",
      "proofState.rootTarget.id",
    );
  } else if (data.rootTargetId) {
    data.rootObligation = data.obligationById.get(data.rootTargetId);
    if (data.rootObligation.relationKind !== "root") {
      context.add(
        "ROOT_OBLIGATION_RELATION_KIND_INVALID",
        "The root obligation must have relationKind root.",
        `proofState.obligations[${obligations.indexOf(data.rootObligation)}].relationKind`,
      );
    }
  }

  const frontier = requireArray(
    proofState,
    "frontierObligationIds",
    "proofState.frontierObligationIds",
    context,
    "FRONTIER_INVALID",
    "proofState.frontierObligationIds must be an array.",
  );
  if (frontier) {
    const frontierIds = new Set();
    frontier.forEach((id, index) => {
      const path = `proofState.frontierObligationIds[${index}]`;
      if (!isNonEmptyString(id)) {
        context.add("FRONTIER_ID_INVALID", "Each frontier obligation id must be a non-empty string.", path);
        return;
      }
      addDuplicateId(context, frontierIds, id, path, "DUPLICATE_FRONTIER_ID", "Frontier obligation");
      const obligation = data.obligationById.get(id);
      if (!obligation) {
        context.add("FRONTIER_OBLIGATION_UNKNOWN", "Frontier obligation id must reference an existing obligation.", path);
      } else if (!["open", "candidate"].includes(obligation.status)) {
        context.add("FRONTIER_OBLIGATION_NOT_OPEN", "Frontier obligations must have status open or candidate.", path);
      }
    });
  }

  const acceptedResults = requireArray(
    proofState,
    "acceptedResults",
    "proofState.acceptedResults",
    context,
    "ACCEPTED_RESULTS_INVALID",
    "proofState.acceptedResults must be an array.",
  );
  if (acceptedResults) {
    acceptedResults.forEach((result, index) => {
      const path = `proofState.acceptedResults[${index}]`;
      const item = requireObject(
        result,
        path,
        context,
        "ACCEPTED_RESULT_INVALID",
        "Each accepted result must be an object.",
      );
      if (!item) return;
      const id = requireString(
        item,
        "id",
        `${path}.id`,
        context,
        "ACCEPTED_RESULT_ID_INVALID",
        "acceptedResults.id must be a non-empty string.",
      );
      if (isNonEmptyString(id) && data.acceptedResultById.has(id)) {
        context.add("DUPLICATE_ACCEPTED_RESULT_ID", "Accepted result id must be unique.", `${path}.id`);
      }
      const status = requireEnum(
        item,
        "status",
        RESULT_STATUSES,
        `${path}.status`,
        context,
        "ACCEPTED_RESULT_STATUS_INVALID",
        "acceptedResults.status is invalid.",
      );
      if (isNonEmptyString(id) && !data.acceptedResultById.has(id)) data.acceptedResultById.set(id, { ...item, status });
    });
  }

  const routes = requireArray(
    proofState,
    "routes",
    "proofState.routes",
    context,
    "ROUTES_INVALID",
    "proofState.routes must be an array.",
  );
  data.routes = routes ?? [];
  if (routes) {
    routes.forEach((route, index) => {
      const path = `proofState.routes[${index}]`;
      const item = requireObject(
        route,
        path,
        context,
        "ROUTE_INVALID",
        "Each route must be an object.",
      );
      if (!item) return;
      const id = requireString(
        item,
        "id",
        `${path}.id`,
        context,
        "ROUTE_ID_INVALID",
        "route.id must be a non-empty string.",
      );
      if (isNonEmptyString(id) && data.routeById.has(id)) {
        context.add("DUPLICATE_ROUTE_ID", "Route id must be unique.", `${path}.id`);
      }
      const obligationId = requireString(
        item,
        "obligationId",
        `${path}.obligationId`,
        context,
        "ROUTE_OBLIGATION_ID_INVALID",
        "route.obligationId must be a non-empty string.",
      );
      requireEnum(
        item,
        "status",
        ROUTE_STATUSES,
        `${path}.status`,
        context,
        "ROUTE_STATUS_INVALID",
        "route.status is invalid.",
      );
      const newInputRefs = requireArray(
        item,
        "newInputRefs",
        `${path}.newInputRefs`,
        context,
        "ROUTE_NEW_INPUT_REFS_INVALID",
        "route.newInputRefs must be an array.",
      );
      if (newInputRefs) {
        validateStringArray(
          newInputRefs,
          `${path}.newInputRefs`,
          context,
          "ROUTE_NEW_INPUT_REF_INVALID",
          "Each route newInputRef must be a non-empty string.",
        );
      }
      if (isNonEmptyString(id) && !data.routeById.has(id)) data.routeById.set(id, { ...item, obligationId });
    });
    for (const [id, route] of data.routeById) {
      if (isNonEmptyString(route.obligationId) && !data.obligationById.has(route.obligationId)) {
        const routeIndex = routes.findIndex((candidate) => candidate === route || (isRecord(candidate) && candidate.id === id));
        context.add(
          "ROUTE_OBLIGATION_UNKNOWN",
          "route.obligationId must reference an existing obligation.",
          `proofState.routes[${routeIndex}].obligationId`,
        );
      }
    }
  }

  const researchOutcome = requireEnum(
    proofState,
    "researchOutcome",
    ["root_completed", "proof_advanced", "route_refuted", "no_verified_progress", "invalidated"],
    "proofState.researchOutcome",
    context,
    "RESEARCH_OUTCOME_INVALID",
    "proofState.researchOutcome is invalid.",
  );
  if (researchOutcome === "root_completed" && data.rootObligation && data.rootObligation.status !== "closed") {
    context.add(
      "ROOT_COMPLETION_INCONSISTENT",
      "researchOutcome root_completed requires the root obligation to be closed.",
      "proofState.researchOutcome",
    );
  }

  data.declaredFingerprint = declaredFingerprint;

  // targetId is intentionally read here so malformed states still get the normal
  // target mismatch diagnostics when a route decision is supplied.
  data.targetId = targetId;
  data.activeContractFingerprint = activeContractFingerprint;
  data.researchOutcome = researchOutcome;
  return data;
}

function rootTargetRefMatches(reference, data) {
  return Boolean(data.rootTarget && isNonEmptyString(data.rootTargetId) && reference === data.rootTargetId);
}

function collectDispatchTasks(routeDecision, data, context) {
  if (!hasOwn(routeDecision, "tasks")) {
    context.add("DISPATCH_TASKS_MISSING", "dispatch route decisions must include tasks.", "routeDecision.tasks");
    return;
  }
  if (!Array.isArray(routeDecision.tasks)) {
    context.add("DISPATCH_TASKS_INVALID", "routeDecision.tasks must be an array.", "routeDecision.tasks");
    return;
  }
  if (routeDecision.tasks.length === 0) {
    context.add("DISPATCH_TASKS_EMPTY", "dispatch route decisions must include at least one task.", "routeDecision.tasks");
    return;
  }

  routeDecision.tasks.forEach((task, index) => {
    const path = `routeDecision.tasks[${index}]`;
    const item = requireObject(
      task,
      path,
      context,
      "DISPATCH_TASK_INVALID",
      "Each dispatch task must be an object.",
    );
    if (!item) return;
    const taskId = requireString(
      item,
      "taskId",
      `${path}.taskId`,
      context,
      "TASK_ID_INVALID",
      "task.taskId must be a non-empty string.",
    );
    void taskId;
    requireString(item, "dialogueRef", `${path}.dialogueRef`, context, "TASK_DIALOGUE_REF_INVALID", "task.dialogueRef must be a non-empty string.");
    const obligationId = requireString(item, "obligationId", `${path}.obligationId`, context, "TASK_OBLIGATION_ID_INVALID", "task.obligationId must be a non-empty string.");
    const obligation = obligationId ? data.obligationById.get(obligationId) : null;
    if (obligationId && !data.obligationById.has(obligationId)) {
      context.add("TASK_OBLIGATION_UNKNOWN", "task.obligationId must reference an existing obligation.", `${path}.obligationId`);
    } else if (obligation && !["open", "candidate"].includes(obligation.status)) {
      context.add("TASK_OBLIGATION_NOT_FRONTIER", "task.obligationId must reference an open or candidate obligation.", `${path}.obligationId`);
    }
    requireString(item, "claim", `${path}.claim`, context, "TASK_CLAIM_INVALID", "task.claim must be a non-empty string.");
    const routeRole = requireEnum(item, "routeRole", ROUTE_ROLES, `${path}.routeRole`, context, "TASK_ROUTE_ROLE_INVALID", "task.routeRole is invalid.");
    const expectedEffect = requireEnum(item, "expectedProofProgressEffect", PROGRESS_EFFECTS, `${path}.expectedProofProgressEffect`, context, "TASK_EXPECTED_EFFECT_INVALID", "task.expectedProofProgressEffect is invalid.");
    const premiseRefs = requireArray(item, "premiseRefs", `${path}.premiseRefs`, context, "TASK_PREMISE_REFS_INVALID", "task.premiseRefs must be an array.");
    const successEffect = requireString(item, "successEffect", `${path}.successEffect`, context, "TASK_SUCCESS_EFFECT_INVALID", "task.successEffect must be a non-empty string.");
    void successEffect;
    const failureEffect = requireString(item, "failureEffect", `${path}.failureEffect`, context, "TASK_FAILURE_EFFECT_INVALID", "task.failureEffect must be a non-empty string.");
    void failureEffect;
    const noveltyStatus = requireEnum(item, "noveltyStatus", KNOWLEDGE_STATUSES, `${path}.noveltyStatus`, context, "TASK_NOVELTY_STATUS_INVALID", "task.noveltyStatus is invalid.");
    const mayCount = hasOwn(item, "mayCountAsRootCompletion") && typeof item.mayCountAsRootCompletion === "boolean";
    if (!mayCount) context.add("TASK_ROOT_COMPLETION_FLAG_INVALID", "task.mayCountAsRootCompletion must be boolean.", `${path}.mayCountAsRootCompletion`);
    const premiseMode = requireEnum(item, "premiseMode", PREMISE_MODES, `${path}.premiseMode`, context, "TASK_PREMISE_MODE_INVALID", "task.premiseMode is invalid.");

    if (premiseRefs) {
      premiseRefs.forEach((ref, refIndex) => {
        const refPath = `${path}.premiseRefs[${refIndex}]`;
        if (!isNonEmptyString(ref)) {
          context.add("TASK_PREMISE_REF_INVALID", "Each task premiseRef must be a non-empty string.", refPath);
          return;
        }
        const result = data.acceptedResultById.get(ref);
        if (!result) {
          context.add("TASK_PREMISE_RESULT_UNKNOWN", "task.premiseRefs must reference acceptedResults.", refPath);
          return;
        }
        if (premiseMode === "accepted_only" && result.status !== "accepted") {
          context.add("TASK_PREMISE_NOT_ACCEPTED", "accepted_only tasks may reference only accepted results.", refPath);
        }
        if (premiseMode === "conditional_exploration" && !["accepted", "conditional"].includes(result.status)) {
          context.add("TASK_PREMISE_STATUS_FORBIDDEN", "conditional_exploration tasks may reference accepted or conditional results only.", refPath);
        }
      });
    }

    if (expectedEffect === "reproduce_known" || obligation?.relationKind === "special_case") {
      const transferId = requireString(item, "transferToObligationId", `${path}.transferToObligationId`, context, "REPRODUCE_KNOWN_TRANSFER_MISSING", "reproduce_known or special-case tasks require transferToObligationId.");
      const transferMechanism = requireString(item, "transferMechanism", `${path}.transferMechanism`, context, "REPRODUCE_KNOWN_MECHANISM_MISSING", "reproduce_known or special-case tasks require a non-empty transferMechanism.");
      void transferMechanism;
      if (transferId && !data.obligationById.has(transferId)) {
        context.add("REPRODUCE_KNOWN_TRANSFER_UNKNOWN", "transferToObligationId must reference an existing obligation.", `${path}.transferToObligationId`);
      }
    }

    if (mayCount && item.mayCountAsRootCompletion === true) {
      if (obligationId !== data.rootTargetId) {
        context.add("TASK_ROOT_COMPLETION_TARGET_INVALID", "mayCountAsRootCompletion is allowed only for the root obligation.", `${path}.obligationId`);
      }
      if (expectedEffect !== "close") {
        context.add("TASK_ROOT_COMPLETION_EFFECT_INVALID", "root completion tasks must expect close.", `${path}.expectedProofProgressEffect`);
      }
      if (premiseMode !== "accepted_only") {
        context.add("TASK_ROOT_COMPLETION_PREMISE_MODE_INVALID", "root completion tasks must use accepted_only premises.", `${path}.premiseMode`);
      }
      if (premiseRefs) {
        premiseRefs.forEach((ref, refIndex) => {
          const result = isNonEmptyString(ref) ? data.acceptedResultById.get(ref) : null;
          if (result && result.status !== "accepted") {
            context.add("TASK_ROOT_COMPLETION_PREMISE_NOT_ACCEPTED", "root completion tasks require every premise to be accepted.", `${path}.premiseRefs[${refIndex}]`);
          }
        });
      }
    }

    const routeId = requireString(item, "routeId", `${path}.routeId`, context, "TASK_ROUTE_ID_INVALID", "task.routeId must be a non-empty string.");
    if (routeId) {
      const route = data.routeById.get(routeId);
      if (!route) {
        context.add("TASK_ROUTE_UNKNOWN", "task.routeId must reference an existing route.", `${path}.routeId`);
      } else {
        if (obligationId && route.obligationId !== obligationId) {
          context.add("TASK_ROUTE_OBLIGATION_MISMATCH", "task.routeId must belong to task.obligationId.", `${path}.routeId`);
        }
        if (["refuted", "blocked", "superseded"].includes(route.status)) {
          const refs = Array.isArray(route.newInputRefs) ? route.newInputRefs : [];
          if (refs.length === 0) {
            context.add("ROUTE_REUSE_NEW_INPUT_REQUIRED", "Reusing a refuted, blocked, or superseded route requires a newInputRef.", `proofState.routes[${findRouteIndex(routeDecision, route, data)}].newInputRefs`);
          } else {
            refs.forEach((ref, refIndex) => {
              const result = isNonEmptyString(ref) ? data.acceptedResultById.get(ref) : null;
              if (!result || result.status !== "accepted") {
                context.add("ROUTE_REUSE_NEW_INPUT_UNKNOWN", "A revived route newInputRef must reference an accepted result.", `proofState.routes[${findRouteIndex(routeDecision, route, data)}].newInputRefs[${refIndex}]`);
              }
            });
          }
        }
      }
    }
    void noveltyStatus;
  });
}

function findRouteIndex(_routeDecision, route, data) {
  // route objects in routeById are shallow copies; route id is enough to give a
  // stable path even when the proof state contains duplicate route objects.
  const routeId = route && route.id;
  const routes = data.routes ?? [];
  const index = routes.findIndex((candidate) => isRecord(candidate) && candidate.id === routeId);
  return index >= 0 ? index : 0;
}

function collectRouteDecision(routeDecision, data, context) {
  const decision = requireObject(
    routeDecision,
    "routeDecision",
    context,
    "ROUTE_DECISION_NOT_OBJECT",
    "routeDecision must be an object.",
  );
  if (!decision) return;

  if (decision.schema !== ROUTE_DECISION_SCHEMA) {
    context.add("ROUTE_DECISION_SCHEMA_INVALID", `routeDecision.schema must be ${ROUTE_DECISION_SCHEMA}.`, "routeDecision.schema");
  }
  requireString(decision, "id", "routeDecision.id", context, "ROUTE_DECISION_ID_INVALID", "routeDecision.id must be a non-empty string.");
  const targetId = requireString(decision, "targetId", "routeDecision.targetId", context, "ROUTE_DECISION_TARGET_ID_INVALID", "routeDecision.targetId must be a non-empty string.");
  if (targetId && data.targetId && targetId !== data.targetId) {
    context.add("ROUTE_DECISION_TARGET_MISMATCH", "routeDecision.targetId must match proofState.targetId.", "routeDecision.targetId");
  }
  const createdAt = requireString(decision, "createdAt", "routeDecision.createdAt", context, "ROUTE_DECISION_CREATED_AT_INVALID", "routeDecision.createdAt must be a non-empty string.");
  void createdAt;

  const rootTargetRef = requireString(
    decision,
    "rootTargetRef",
    "routeDecision.rootTargetRef",
    context,
    "ROUTE_DECISION_ROOT_REF_INVALID",
    "routeDecision.rootTargetRef must be a non-empty string.",
  );
  if (rootTargetRef && !rootTargetRefMatches(rootTargetRef, data)) {
    context.add("ROUTE_DECISION_ROOT_REF_MISMATCH", "routeDecision.rootTargetRef must match proofState.rootTarget.", "routeDecision.rootTargetRef");
  }
  const activeContractFingerprint = requireString(decision, "activeContractFingerprint", "routeDecision.activeContractFingerprint", context, "ROUTE_DECISION_CONTRACT_FINGERPRINT_INVALID", "routeDecision.activeContractFingerprint must be a non-empty string.");
  if (activeContractFingerprint && data.activeContractFingerprint && activeContractFingerprint !== data.activeContractFingerprint) {
    context.add("ROUTE_DECISION_CONTRACT_FINGERPRINT_MISMATCH", "routeDecision.activeContractFingerprint must match proofState.activeContractFingerprint.", "routeDecision.activeContractFingerprint");
  }
  const basedOnFingerprint = requireString(decision, "basedOnProofStateFingerprint", "routeDecision.basedOnProofStateFingerprint", context, "ROUTE_DECISION_STATE_FINGERPRINT_INVALID", "routeDecision.basedOnProofStateFingerprint must be a non-empty string.");
  if (basedOnFingerprint && data.declaredFingerprint && basedOnFingerprint !== data.declaredFingerprint) {
    context.add("ROUTE_DECISION_STATE_FINGERPRINT_MISMATCH", "routeDecision.basedOnProofStateFingerprint must match proofState fingerprint.", "routeDecision.basedOnProofStateFingerprint");
  }
  const action = requireEnum(decision, "action", ACTIONS, "routeDecision.action", context, "ROUTE_DECISION_ACTION_INVALID", "routeDecision.action is invalid.");
  if (!action) return;

  if (action === "dispatch") {
    if (hasOwn(decision, "grilling")) {
      context.add("DISPATCH_GRILLING_FORBIDDEN", "dispatch route decisions must not contain grilling.", "routeDecision.grilling");
    }
    if (hasOwn(decision, "stopReason")) {
      context.add("DISPATCH_STOP_REASON_FORBIDDEN", "dispatch route decisions must not contain stopReason.", "routeDecision.stopReason");
    }
    collectDispatchTasks(decision, data, context);
    return;
  }

  if (action === "ask_user") {
    if (hasOwn(decision, "tasks")) {
      context.add("ASK_USER_TASKS_FORBIDDEN", "ask_user route decisions must not contain tasks.", "routeDecision.tasks");
    }
    if (hasOwn(decision, "stopReason")) {
      context.add("ASK_USER_STOP_REASON_FORBIDDEN", "ask_user route decisions must not contain stopReason.", "routeDecision.stopReason");
    }
    const grilling = requireObject(decision.grilling, "routeDecision.grilling", context, "GRILLING_INVALID", "ask_user route decisions require a grilling object.");
    if (grilling) {
      if (grilling.skill !== "grilling") {
        context.add("GRILLING_SKILL_INVALID", "routeDecision.grilling.skill must be grilling.", "routeDecision.grilling.skill");
      }
      requireString(grilling, "reason", "routeDecision.grilling.reason", context, "GRILLING_REASON_INVALID", "grilling.reason must be a non-empty string.");
      const questions = requireArray(grilling, "questions", "routeDecision.grilling.questions", context, "GRILLING_QUESTIONS_INVALID", "grilling.questions must be a non-empty array.");
      if (questions && questions.length === 0) {
        context.add("GRILLING_QUESTIONS_EMPTY", "grilling.questions must not be empty.", "routeDecision.grilling.questions");
      } else if (questions) {
        questions.forEach((question, index) => {
          if (!isNonEmptyString(question)) {
            context.add("GRILLING_QUESTION_INVALID", "Each grilling question must be a non-empty string.", `routeDecision.grilling.questions[${index}]`);
          }
        });
      }
    }
    return;
  }

  if (hasOwn(decision, "tasks")) {
    context.add("STOP_TASKS_FORBIDDEN", "stop route decisions must not contain tasks.", "routeDecision.tasks");
  }
  if (hasOwn(decision, "grilling")) {
    context.add("STOP_GRILLING_FORBIDDEN", "stop route decisions must not contain grilling.", "routeDecision.grilling");
  }
  const stopReason = requireEnum(decision, "stopReason", STOP_REASONS, "routeDecision.stopReason", context, "STOP_REASON_INVALID", "stopReason is invalid.");
  if (stopReason === "root_completed") {
    if (!data.rootObligation || data.rootObligation.status !== "closed" || data.researchOutcome !== "root_completed") {
      context.add(
        "STOP_ROOT_COMPLETED_INCONSISTENT",
        "stopReason root_completed requires a closed root obligation and researchOutcome root_completed.",
        "routeDecision.stopReason",
      );
    }
  }
}

/**
 * Validate a proof state and, when supplied, a route decision against it.
 * The return value always has the shape { valid, ok, errors }.
 */
export function validateProofRouting(proofState, routeDecision = undefined) {
  const context = createContext();
  const data = collectProofState(proofState, context);
  if (routeDecision !== undefined) collectRouteDecision(routeDecision, data, context);
  return makeResult(context.errors);
}

export const validateRouting = validateProofRouting;

export function validateProofState(proofState) {
  return validateProofRouting(proofState);
}

export function validateRouteDecision(routeDecision, proofState) {
  return validateProofRouting(proofState, routeDecision);
}

function stableSerialize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
}

/** Return a deterministic SHA-256 fingerprint for a JSON proof state. */
export function proofStateFingerprint(proofState) {
  return createHash("sha256").update(stableSerialize(proofState)).digest("hex");
}

function parseCliArguments(args) {
  let proofStatePath;
  let routeDecisionPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--proof-state" || arg === "--route-decision") {
      if (index + 1 >= args.length || args[index + 1].startsWith("--")) {
        return { error: { code: "CLI_ARGUMENT_MISSING", message: `${arg} requires a path.`, path: arg } };
      }
      if (arg === "--proof-state") proofStatePath = args[index + 1];
      else routeDecisionPath = args[index + 1];
      index += 1;
    } else {
      return { error: { code: "CLI_ARGUMENT_UNKNOWN", message: `Unknown argument ${arg}.`, path: "argv" } };
    }
  }
  if (!proofStatePath) {
    return { error: { code: "CLI_PROOF_STATE_REQUIRED", message: "--proof-state <path> is required.", path: "--proof-state" } };
  }
  return { proofStatePath, routeDecisionPath };
}

function readJsonFile(filePath, path, errors) {
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (error) {
    errors.push({ code: "CLI_FILE_READ_FAILED", message: `Could not read ${filePath}: ${error.message}`, path });
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    errors.push({ code: "CLI_JSON_INVALID", message: `Could not parse ${filePath} as JSON: ${error.message}`, path });
    return undefined;
  }
}

function runCli(args) {
  const parsed = parseCliArguments(args);
  if (parsed.error) return makeResult([parsed.error]);
  const cliErrors = [];
  const proofState = readJsonFile(parsed.proofStatePath, "--proof-state", cliErrors);
  const routeDecision = parsed.routeDecisionPath
    ? readJsonFile(parsed.routeDecisionPath, "--route-decision", cliErrors)
    : undefined;
  if (cliErrors.length > 0) return makeResult(cliErrors);
  return validateProofRouting(proofState, routeDecision);
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.valid ? 0 : 1;
}

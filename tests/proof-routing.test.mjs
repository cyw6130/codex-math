import assert from "node:assert/strict";
import test from "node:test";

import { validateProofRouting } from "../tools/validate-proof-routing.mjs";

function proofState(overrides = {}) {
  return {
    schema: "run-math/proof-state-v1",
    targetId: "the-proof",
    rootTarget: {
      id: "root",
      statement: "Every object in the target class has the desired property.",
      scope: "general target",
      normalizationBoundary: "fixed conventions",
      verbatimUserGoal: "Prove that every object in the target class has the desired property.",
      sourceRequestRef: "user-request-1",
      fingerprint: "contract-v1",
    },
    activeContractFingerprint: "contract-v1",
    fingerprint: "state-v1",
    contractRevisions: [],
    knowledgeBoundary: {
      knowledgeStatus: "known",
      knownResultsBoundary: "one accepted lemma",
      sourceRefs: ["source:lemma"],
      routeImplication: "Use the accepted lemma as a premise.",
    },
    obligations: [
      {
        id: "root",
        statement: "Prove the general target.",
        relationKind: "root",
        relationToRoot: "root",
        dependencies: [],
        status: "open",
        supportRefs: [],
        currentGap: "A complete proof is still missing.",
      },
      {
        id: "stage1",
        statement: "Construct the finite certificate needed by the proof.",
        relationKind: "lemma",
        relationToRoot: "supporting stage",
        dependencies: ["root"],
        status: "candidate",
        supportRefs: ["source:lemma"],
        currentGap: "Need a certificate.",
      },
    ],
    routes: [
      { id: "main-route", obligationId: "stage1", status: "active", newInputRefs: [] },
    ],
    frontierObligationIds: ["stage1"],
    acceptedResults: [{ id: "known-lemma", status: "accepted" }],
    researchOutcome: "proof_advanced",
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    taskId: "task-1",
    dialogueRef: "proof-dialogue-1",
    obligationId: "stage1",
    routeId: "main-route",
    claim: "Build the finite certificate for Stage 1.",
    routeRole: "finite_certificate",
    expectedProofProgressEffect: "construct_certificate",
    premiseRefs: ["known-lemma"],
    successEffect: "Close Stage 1 if the certificate checks out.",
    failureEffect: "Record the exact missing hypothesis.",
    noveltyStatus: "open",
    mayCountAsRootCompletion: false,
    premiseMode: "accepted_only",
    ...overrides,
  };
}

function routeDecision(overrides = {}) {
  return {
    schema: "run-math/route-decision-v1",
    id: "decision-1",
    targetId: "the-proof",
    createdAt: "2026-08-29T00:00:00Z",
    rootTargetRef: "root",
    activeContractFingerprint: "contract-v1",
    basedOnProofStateFingerprint: "state-v1",
    action: "dispatch",
    tasks: [task()],
    ...overrides,
  };
}

function codes(result) {
  return result.errors.map((error) => error.code);
}

test("accepts a The Proof-style finite certificate route while the root remains open", () => {
  const result = validateProofRouting(proofState(), routeDecision());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejects spending budget on a figure-eight special case without a transfer bridge", () => {
  const state = proofState({
    rootTarget: {
      id: "root",
      statement: "The general KMM conjecture holds.",
      scope: "general KMM",
      normalizationBoundary: "fixed conventions",
      verbatimUserGoal: "Prove the general KMM conjecture.",
      sourceRequestRef: "user-request-1",
      fingerprint: "contract-v1",
    },
    obligations: [
      proofState().obligations[0],
      {
        id: "figure-eight",
        statement: "The figure-eight case holds.",
        relationKind: "special_case",
        relationToRoot: "special case",
        dependencies: ["root"],
        status: "candidate",
        supportRefs: [],
        currentGap: "Only the special case is addressed.",
      },
    ],
    routes: [{ id: "main-route", obligationId: "figure-eight", status: "active", newInputRefs: [] }],
    frontierObligationIds: ["figure-eight"],
  });
  const result = validateProofRouting(
    state,
    routeDecision({
      tasks: [
        task({
          obligationId: "figure-eight",
          routeId: "main-route",
          expectedProofProgressEffect: "close",
          mayCountAsRootCompletion: false,
        }),
      ],
    }),
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("REPRODUCE_KNOWN_TRANSFER_MISSING"));
  assert.ok(codes(result).includes("REPRODUCE_KNOWN_MECHANISM_MISSING"));
});

test("accepts a special case only when it has an explicit transfer bridge", () => {
  const base = proofState();
  const state = proofState({
    obligations: [
      base.obligations[0],
      base.obligations[1],
      {
        id: "rank-one-case",
        statement: "Establish the known rank-one model used by the bridge.",
        relationKind: "special_case",
        relationToRoot: "Tests the specialization bridge into Stage 1.",
        dependencies: ["stage1"],
        status: "open",
        supportRefs: [],
        currentGap: "The transfer bridge must be verified.",
      },
    ],
    routes: [{ id: "rank-one-route", obligationId: "rank-one-case", status: "active", newInputRefs: [] }],
    frontierObligationIds: ["rank-one-case"],
  });
  const result = validateProofRouting(
    state,
    routeDecision({
      tasks: [
        task({
          obligationId: "rank-one-case",
          routeId: "rank-one-route",
          routeRole: "alternative_route",
          expectedProofProgressEffect: "verify_premise",
          transferToObligationId: "stage1",
          transferMechanism: "Verify that the rank-one identity specializes to the Stage 1 certificate.",
        }),
      ],
    }),
  );
  assert.equal(result.valid, true);
});

test("rejects reproduce_known without a transfer bridge and accepts it with one", () => {
  const missingBridge = validateProofRouting(
    proofState(),
    routeDecision({
      tasks: [task({ routeRole: "alternative_route", expectedProofProgressEffect: "reproduce_known" })],
    }),
  );
  assert.equal(missingBridge.valid, false);
  assert.ok(codes(missingBridge).includes("REPRODUCE_KNOWN_TRANSFER_MISSING"));
  assert.ok(codes(missingBridge).includes("REPRODUCE_KNOWN_MECHANISM_MISSING"));

  const withBridge = validateProofRouting(
    proofState(),
    routeDecision({
      tasks: [
        task({
          routeRole: "alternative_route",
          expectedProofProgressEffect: "reproduce_known",
          transferToObligationId: "stage1",
          transferMechanism: "Translate the known calculation into the Stage 1 certificate.",
        }),
      ],
    }),
  );
  assert.equal(withBridge.valid, true);
});

test("rejects a conditional premise from claiming root completion", () => {
  const state = proofState({
    acceptedResults: [
      { id: "known-lemma", status: "accepted" },
      { id: "conditional-lemma", status: "conditional" },
    ],
  });
  const result = validateProofRouting(
    state,
    routeDecision({
      tasks: [
        task({
          obligationId: "root",
          expectedProofProgressEffect: "close",
          premiseRefs: ["conditional-lemma"],
          mayCountAsRootCompletion: true,
          premiseMode: "conditional_exploration",
        }),
      ],
    }),
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("TASK_ROOT_COMPLETION_PREMISE_MODE_INVALID"));
});

test("rejects changing the active contract fingerprint without a grilling revision", () => {
  const result = validateProofRouting(proofState({ activeContractFingerprint: "contract-v2" }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("ACTIVE_CONTRACT_FINGERPRINT_WITHOUT_GRILLING"));
});

test("rejects a route decision based on a stale proof-state fingerprint", () => {
  const result = validateProofRouting(proofState(), routeDecision({ basedOnProofStateFingerprint: "state-v0" }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("ROUTE_DECISION_STATE_FINGERPRINT_MISMATCH"));
});

test("rejects a dispatch task that omits route lineage", () => {
  const orphanTask = task();
  delete orphanTask.routeId;
  const result = validateProofRouting(proofState(), routeDecision({ tasks: [orphanTask] }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("TASK_ROUTE_ID_INVALID"));
});

test("rejects reviving a refuted route without accepted new input", () => {
  const state = proofState({
    routes: [{ id: "main-route", obligationId: "stage1", status: "refuted", newInputRefs: [] }],
  });
  const result = validateProofRouting(state, routeDecision({ tasks: [task({ routeId: "main-route" })] }));
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("ROUTE_REUSE_NEW_INPUT_REQUIRED"));
});

test("accepts an ask_user decision with the grilling skill", () => {
  const decisionWithTasks = routeDecision({
    action: "ask_user",
    grilling: {
      skill: "grilling",
      reason: "The target has two materially different readings.",
      questions: ["Which normalization boundary should govern the next round?"],
    },
    tasks: undefined,
  });
  const invalid = validateProofRouting(proofState(), decisionWithTasks);
  assert.equal(invalid.valid, false);
  assert.ok(codes(invalid).includes("ASK_USER_TASKS_FORBIDDEN"));

  const decision = routeDecision({
    action: "ask_user",
    grilling: {
      skill: "grilling",
      reason: "The target has two materially different readings.",
      questions: ["Which normalization boundary should govern the next round?"],
    },
  });
  delete decision.tasks;
  const valid = validateProofRouting(proofState(), decision);
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.errors, []);
});

test("rejects stop root_completed when proof state root is not closed and complete", () => {
  const decision = routeDecision({ action: "stop", stopReason: "root_completed" });
  delete decision.tasks;
  const result = validateProofRouting(
    proofState(),
    decision,
  );
  assert.equal(result.valid, false);
  assert.ok(codes(result).includes("STOP_ROOT_COMPLETED_INCONSISTENT"));
});

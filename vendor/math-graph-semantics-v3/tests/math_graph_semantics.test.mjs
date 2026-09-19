import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);

test("derives the established Claim closure and its direct proof witnesses", () => {
  const M = {
    entries: [
      { id: "f", entryClass: "fact", factKind: "definition", title: "Definition F", statement: "F" },
      { id: "c0", entryClass: "claim", claimKind: "lemma", title: "Lemma C0", statement: "C0" },
      { id: "c1", entryClass: "claim", claimKind: "theorem", title: "Theorem C1", statement: "C1" },
    ],
    inferences: [
      {
        id: "p",
        operationKind: "proof",
        premises: ["f", "c0"],
        conclusion: "c1",
        argument: "The definition and the B0 lemma establish the theorem.",
      },
    ],
    negationPairs: [],
    b0ClaimEntryIds: ["c0"],
  };

  const state = require("../src/index.js").deriveMathState(M);

  assert.deepEqual(state.availableFactIds, ["f"]);
  assert.deepEqual(state.b0ClaimEntryIds, ["c0"]);
  assert.deepEqual(state.closureClaimEntryIds, ["c0", "c1"]);
  assert.deepEqual(state.claimStates, { c0: "established", c1: "established" });
  assert.equal(state.claimDerivations.c0.basis, "b0");
  assert.deepEqual(state.claimDerivations.c1.establishingProofIds, ["p"]);
});

test("explains every blocked proof path for open Claims", () => {
  const M = {
    entries: [
      { id: "f", entryClass: "fact", factKind: "definition", title: "Definition F", statement: "F" },
      { id: "a", entryClass: "claim", claimKind: "lemma", title: "Lemma A", statement: "A" },
      { id: "b", entryClass: "claim", claimKind: "lemma", title: "Lemma B", statement: "B" },
      { id: "c", entryClass: "claim", claimKind: "theorem", title: "Theorem C", statement: "C" },
      { id: "d", entryClass: "claim", claimKind: "proposition", title: "Proposition D", statement: "D" },
    ],
    inferences: [
      { id: "p1", operationKind: "proof", premises: ["f", "a"], conclusion: "c", argument: "F and A imply C." },
      { id: "p2", operationKind: "proof", premises: ["a", "b"], conclusion: "c", argument: "A and B imply C." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };

  const state = require("../src/index.js").deriveMathState(M);

  assert.deepEqual(state.claimDerivations.c, {
    basis: "open",
    blockedProofs: [
      { proofId: "p1", missingPremiseIds: ["a"] },
      { proofId: "p2", missingPremiseIds: ["a", "b"] },
    ],
  });
  assert.deepEqual(state.claimDerivations.d, { basis: "open", reason: "no_proof" });
});

test("derives refuted from an established paired Negative Claim", () => {
  const M = {
    entries: [
      { id: "p", entryClass: "claim", claimKind: "proposition", title: "P", statement: "P" },
      { id: "not-p", entryClass: "claim", claimKind: "proposition", title: "Not P", statement: "Not P" },
    ],
    inferences: [],
    negationPairs: [{ claimEntryIds: ["p", "not-p"] }],
    b0ClaimEntryIds: ["not-p"],
  };

  const state = require("../src/index.js").deriveMathState(M);

  assert.deepEqual(state.claimStates, { p: "refuted", "not-p": "established" });
  assert.deepEqual(state.claimDerivations.p, {
    basis: "negation",
    negatingClaimEntryId: "not-p",
    negationPairClaimEntryIds: ["p", "not-p"],
  });
});

test("rejects a state whose Negation Pair endpoints both enter Closure", () => {
  const M = {
    entries: [
      { id: "p", entryClass: "claim", claimKind: "proposition", title: "P", statement: "P" },
      { id: "not-p", entryClass: "claim", claimKind: "proposition", title: "Not P", statement: "Not P" },
    ],
    inferences: [],
    negationPairs: [{ claimEntryIds: ["p", "not-p"] }],
    b0ClaimEntryIds: ["p", "not-p"],
  };

  assert.throws(
    () => require("../src/index.js").deriveMathState(M),
    (error) => error?.code === "CONTRADICTORY_CLOSURE",
  );
});

test("rejects structures outside the closed Math Map State Space", () => {
  const base = {
    entries: [
      { id: "f", entryClass: "fact", factKind: "definition", title: "F", statement: "F" },
      { id: "c", entryClass: "claim", claimKind: "theorem", title: "C", statement: "C" },
    ],
    inferences: [
      { id: "p", operationKind: "proof", premises: ["f"], conclusion: "c", argument: "F implies C." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };
  const invalidCases = [
    ["UNKNOWN_FIELD", (M) => { M.extra = true; }],
    ["UNKNOWN_FIELD", (M) => { M.entries[0].color = "blue"; }],
    ["INVALID_ENTRY", (M) => { M.entries[0].entryClass = "draft"; }],
    ["DUPLICATE_ID", (M) => { M.inferences[0].id = "f"; }],
    ["INVALID_INFERENCE", (M) => { M.inferences[0].premises = []; }],
    ["INVALID_INFERENCE", (M) => { M.inferences[0].argument = " "; }],
    ["INVALID_INFERENCE", (M) => { M.inferences[0].premises = ["f", "f"]; }],
    ["UNKNOWN_REFERENCE", (M) => { M.inferences[0].premises = ["missing"]; }],
    ["INVALID_NEGATION_PAIR", (M) => { M.negationPairs = [{ claimEntryIds: ["f", "c"] }]; }],
    ["INVALID_B0", (M) => { M.b0ClaimEntryIds = ["f"]; }],
    ["INVALID_B0", (M) => { M.b0ClaimEntryIds = ["c"]; }],
  ];

  for (const [expectedCode, mutate] of invalidCases) {
    const M = structuredClone(base);
    mutate(M);
    assert.throws(
      () => require("../src/index.js").deriveMathState(M),
      (error) => error?.code === expectedCode,
    );
  }
});

test("derives deterministically without mutating the strict mathematical state", () => {
  const M = {
    entries: [
      { id: "f", entryClass: "fact", factKind: "calculation", title: "Calculation F", statement: "F" },
      { id: "c", entryClass: "claim", claimKind: "proposition", title: "Proposition C", statement: "C" },
    ],
    inferences: [
      { id: "p", operationKind: "proof", premises: ["f"], conclusion: "c", argument: "F establishes C." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };
  const original = structuredClone(M);

  const first = require("../src/index.js").deriveMathState(M);
  const second = require("../src/index.js").deriveMathState(M);

  assert.deepEqual(M, original);
  assert.deepEqual(second, first);
});

test("publishes the same deep interface as a browser runtime asset", () => {
  const source = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const browser = {};
  vm.runInNewContext(source, browser);

  assert.equal(browser.GammaMathMapSemantics.CAPABILITY_ID, "cmath-gamma.math-map-semantics/v3");
  assert.equal(browser.GammaMathMapSemantics.STATE_CONTRACT, "cmath.math-map-state/v3");
  assert.deepEqual([...browser.GammaMathMapSemantics.FACT_KINDS], ["definition", "algorithm", "calculation"]);
  assert.deepEqual([...browser.GammaMathMapSemantics.CLAIM_KINDS], ["lemma", "proposition", "theorem"]);
  assert.deepEqual([...browser.GammaMathMapSemantics.INFERENCE_KINDS], ["proof", "organization"]);
  assert.equal(typeof browser.GammaMathMapSemantics.deriveMathState, "function");
});

test("accepts concept-forming organization but excludes it from Closure", () => {
  const M = {
    entries: [
      { id: "c", entryClass: "claim", claimKind: "lemma", title: "C", statement: "C" },
      { id: "f", entryClass: "fact", factKind: "definition", title: "F", statement: "F" },
    ],
    inferences: [
      { id: "o", operationKind: "organization", premises: ["c"], conclusion: "f", argument: "C is organized into definition F." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };

  const state = require("../src/index.js").deriveMathState(M);
  assert.deepEqual(state.availableFactIds, ["f"]);
  assert.deepEqual(state.claimStates, { c: "open" });
});

test("rejects organization cycles while proof cycles require an external entry", () => {
  const organizationCycle = {
    entries: [
      { id: "f1", entryClass: "fact", factKind: "definition", title: "F1", statement: "F1" },
      { id: "f2", entryClass: "fact", factKind: "definition", title: "F2", statement: "F2" },
    ],
    inferences: [
      { id: "o1", operationKind: "organization", premises: ["f1"], conclusion: "f2", argument: "F1 forms F2." },
      { id: "o2", operationKind: "organization", premises: ["f2"], conclusion: "f1", argument: "F2 forms F1." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };
  assert.throws(
    () => require("../src/index.js").deriveMathState(organizationCycle),
    (error) => error?.code === "ORGANIZATION_CYCLE",
  );

  const proofCycle = {
    entries: [
      { id: "a", entryClass: "claim", claimKind: "lemma", title: "A", statement: "A" },
      { id: "b", entryClass: "claim", claimKind: "lemma", title: "B", statement: "B" },
    ],
    inferences: [
      { id: "pa", operationKind: "proof", premises: ["b"], conclusion: "a", argument: "B implies A." },
      { id: "pb", operationKind: "proof", premises: ["a"], conclusion: "b", argument: "A implies B." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };
  assert.deepEqual(
    require("../src/index.js").deriveMathState(proofCycle).claimStates,
    { a: "open", b: "open" },
  );

  proofCycle.b0ClaimEntryIds = ["a"];
  assert.deepEqual(
    require("../src/index.js").deriveMathState(proofCycle).claimStates,
    { a: "established", b: "established" },
  );
});

test("returns every available direct proof as an alternative witness", () => {
  const M = {
    entries: [
      { id: "f1", entryClass: "fact", factKind: "definition", title: "F1", statement: "F1" },
      { id: "f2", entryClass: "fact", factKind: "algorithm", title: "F2", statement: "F2" },
      { id: "c", entryClass: "claim", claimKind: "theorem", title: "C", statement: "C" },
    ],
    inferences: [
      { id: "p1", operationKind: "proof", premises: ["f1"], conclusion: "c", argument: "F1 implies C." },
      { id: "p2", operationKind: "proof", premises: ["f2"], conclusion: "c", argument: "F2 implies C." },
    ],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };

  assert.deepEqual(
    require("../src/index.js").deriveMathState(M).claimDerivations.c.establishingProofIds,
    ["p1", "p2"],
  );
});

test("treats Negation Pair identity as unordered and one-to-one", () => {
  const entries = ["p", "not-p", "q"].map((id) => ({
    id,
    entryClass: "claim",
    claimKind: "proposition",
    title: id,
    statement: id,
  }));
  const makeState = (negationPairs) => ({ entries, inferences: [], negationPairs, b0ClaimEntryIds: [] });

  for (const negationPairs of [
    [{ claimEntryIds: ["p", "not-p"] }, { claimEntryIds: ["not-p", "p"] }],
    [{ claimEntryIds: ["p", "not-p"] }, { claimEntryIds: ["p", "q"] }],
  ]) {
    assert.throws(
      () => require("../src/index.js").deriveMathState(makeState(negationPairs)),
      (error) => error?.code === "INVALID_NEGATION_PAIR",
    );
  }
});

test("publishes a candidate canonical manifest and the confirmed contract", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  const contract = readFileSync(new URL("../contract/MATH_MAP_STATE_SPACE_V3.md", import.meta.url), "utf8");

  assert.equal(manifest.id, "math-graph-semantics-v3");
  assert.equal(manifest.version, "v3");
  assert.equal(manifest.status, "candidate");
  assert.equal(manifest.provides[0].contract, "cmath-gamma.math-map-semantics/v3");
  assert.equal(manifest.provides[1].contract, "cmath.math-map-state/v3");
  assert.equal(manifest.runtime.kind, "browser-global-or-commonjs");
  assert.deepEqual(manifest.acceptanceTests, ["tests/math_graph_semantics.test.mjs"]);
  for (const requiredText of [
    "M = Entries + Inferences + NegationPairs + B0",
    "open | established | refuted",
    "CONTRADICTORY_CLOSURE",
    "deriveMathState(M)",
    "项目级叙事角色",
    "不表示逻辑强弱、证明难度、可信等级或证明状态",
    "进入严格数学状态 M 时确定，此后不变",
    "外部来源中的命名不决定项目内角色",
    "Corollary 不是第四种 Claim kind",
  ]) {
    assert.match(contract, new RegExp(requiredText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("preserves every contract-valid opaque ID without prototype or pair-key collisions", () => {
  const prototypeIdState = {
    entries: [
      { id: "__proto__", entryClass: "claim", claimKind: "lemma", title: "Prototype", statement: "Prototype" },
    ],
    inferences: [],
    negationPairs: [],
    b0ClaimEntryIds: [],
  };
  const prototypeResult = require("../src/index.js").deriveMathState(prototypeIdState);
  assert.equal(Object.hasOwn(prototypeResult.claimStates, "__proto__"), true);
  assert.equal(prototypeResult.claimStates.__proto__, "open");
  assert.equal(Object.hasOwn(prototypeResult.claimDerivations, "__proto__"), true);

  const ids = ["a\u0000b", "c", "a", "b\u0000c"];
  const collisionState = {
    entries: ids.map((id) => ({ id, entryClass: "claim", claimKind: "lemma", title: id, statement: id })),
    inferences: [],
    negationPairs: [
      { claimEntryIds: ["a\u0000b", "c"] },
      { claimEntryIds: ["a", "b\u0000c"] },
    ],
    b0ClaimEntryIds: [],
  };
  assert.deepEqual(
    require("../src/index.js").deriveMathState(collisionState).closureClaimEntryIds,
    [],
  );
});

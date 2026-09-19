"use strict";

const { projectWorkingView } = require("../../../../research-project/state/research-draft-lifecycle-v1/src/index.js");
const { deriveMathState } = require("../../../../math-map/state/math-graph-semantics-v3/src/index.js");

function plain(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function entryProjection(entry) {
  return {
    id: entry.id,
    c: entry.entryClass,
    k: entry.entryClass === "fact" ? entry.factKind : entry.claimKind,
    t: entry.title,
    s: entry.statement,
  };
}

function inferenceProjection(inference) {
  const premises = [...inference.premises];
  return {
    id: inference.id,
    t: inference.title ?? `${inference.operationKind} · ${premises.length} 个前提`,
    k: inference.operationKind,
    p: premises,
    c: inference.conclusion,
    a: inference.argument,
  };
}

function projectCurrent(request) {
  if (!plain(request)) throw new TypeError("projectCurrent expects one request object");
  if (request.title !== undefined && (typeof request.title !== "string" || !request.title.trim())) {
    throw new TypeError("title must be a non-empty string when present");
  }

  const working = projectWorkingView({ snapshot: request.snapshot, draft_graph: request.draft_graph });
  const accepted = working.accepted;
  const math = deriveMathState(accepted.M);
  const acceptedEntries = accepted.M.entries.map(entryProjection);
  const acceptedInferences = accepted.M.inferences.map(inferenceProjection);
  const draftEntries = working.draft.entries.map(({ entry }) => entryProjection(entry));
  const draftInferences = working.draft.inferences.map(({ inference }) => inferenceProjection(inference));
  const entries = [...acceptedEntries, ...draftEntries];
  const infs = [...acceptedInferences, ...draftInferences];
  const acceptedIds = new Set([...acceptedEntries, ...acceptedInferences].map((item) => item.id));
  const nodes = [
    ...entries.map((entry) => ({ id: entry.id, t: "e", c: entry.c })),
    ...infs.map((inference) => ({ id: inference.id, t: "i" })),
  ];
  const links = [];
  const prem = {};
  const succ = {};
  for (const inference of infs) {
    for (const premise of inference.p) {
      links.push({ source: premise, target: inference.id, r: "p" });
      (succ[premise] ??= []).push({ inf: inference.id, to: inference.c });
    }
    links.push({ source: inference.id, target: inference.c, r: "c" });
    (prem[inference.c] ??= []).push({ inf: inference.id, k: inference.k, n: inference.p.length });
  }

  const states = { ...math.claimStates };
  const deriv = { ...math.claimDerivations };
  const pending = (working.draft.pending_records ?? []).map((record) => ({
    draft_id: record.draft_id,
    message: record.pending.message,
  }));
  const title = request.title ?? `Research Snapshot ${accepted.snapshot_id}`;
  const status = Object.fromEntries(nodes.map((node) => [node.id, acceptedIds.has(node.id) ? "acc" : "draft"]));
  return {
    name: `research-current-${accepted.state_id}-${accepted.revision}`,
    title,
    entries,
    infs,
    nodes,
    links,
    b0: [...accepted.M.b0ClaimEntryIds],
    states,
    deriv,
    prem,
    succ,
    current: {
      state_id: accepted.state_id,
      snapshot_id: accepted.snapshot_id,
      revision: accepted.revision,
      status,
      pending,
    },
  };
}

module.exports = Object.freeze({ projectCurrent });

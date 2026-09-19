/**
 * @cmath-provenance
 * @package math-map-naming-v2
 * @version v2
 * @canonicalSource packages/math-map/presentation/math-map-naming-v2/src/index.js
 * @contentHash sha256:55fbb6a7cfe141f63ef1269ca5deced2024c0895bfa2b3c2d906abf56685661a
 * @syncAuthority CMath-capabilities/exports/canonical.json
 * @warning DO NOT EDIT DIRECTLY. Synchronize from CMath-capabilities.
 */
/* Stable mathematical-map identities and search aliases. */
(function publishMathMapNaming(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GammaMathMapNaming = api;
})(typeof window !== "undefined" ? window : globalThis, function createMathMapNaming() {
  "use strict";

  const CAPABILITY_ID = "cmath-gamma.math-map-naming/v2";
  const LEGACY_CAPABILITY_ID = "cmath-gamma.math-map-naming/v1";
  const LEDGER_SCHEMA = "cmath-gamma.math-map-numbering-ledger/v1";
  const ALLOCATION_STATES = Object.freeze(["active", "retired", "merged"]);
  const CANONICAL_PATTERN = /^(定义|算法|计算|引理|命题|定理|组织|证明)\s*·\s*(\d+)\s*·\s*(.+)$/u;
  const PENDING_PATTERN = /^(定义|算法|计算|引理|命题|定理|组织|证明)\s*·\s*待编号\s*·\s*(.+)$/u;
  const LEGACY_PATTERN = /^(定义|算法|计算|引理|命题|定理|组织|证明)\s*·\s*(.+?)\s*·\s*(\d+)$/u;
  const SOURCE_PATTERN = /^(.+?)\s+(\d+)\s+·\s+(.+)$/u;
  const aliases = Object.freeze({ 定义: "定义", 约定: "定义", 构造: "算法", 算法: "算法", 计算: "计算", 计算结果: "计算", 例子: "计算", 引理: "引理", 命题: "命题", 开放问题: "命题", 反例: "命题", 定理: "定理", 组织: "组织", 推导: "证明", 证明: "证明" });
  const semanticKinds = Object.freeze({
    definition: "定义", convention: "定义",
    algorithm: "算法", construction: "算法",
    calculation: "计算", computation: "计算",
    lemma: "引理", proposition: "命题", open_problem: "命题", counterexample: "命题",
    theorem: "定理", organization: "组织", proof: "证明",
  });

  const mathematicalShortTitle = (item) => item?.mathematicalShortTitle ?? item?.shortTitle
    ?? item?.semantic?.mathematicalShortTitle ?? item?.semanticModel?.mathematicalShortTitle ?? null;

  function composeBoardName(label, shortTitle) {
    const labelMatch = String(label ?? "").trim().match(/^(.+?)\s+(\d+)$/u);
    const short = String(shortTitle ?? "").trim();
    const kind = labelMatch ? aliases[labelMatch[1]] : null;
    return kind && short ? `${kind} · ${Number(labelMatch[2])} · ${short}` : null;
  }

  function normalizeBoardName(value) {
    const text = String(value ?? "").trim();
    let match = text.match(CANONICAL_PATTERN);
    if (match) return `${match[1]} · ${Number(match[2])} · ${match[3].trim()}`;
    match = text.match(LEGACY_PATTERN);
    if (match) return `${match[1]} · ${Number(match[3])} · ${match[2].trim()}`;
    match = text.match(SOURCE_PATTERN);
    if (match && aliases[match[1]]) return `${aliases[match[1]]} · ${Number(match[2])} · ${match[3].trim()}`;
    return null;
  }

  const isValidBoardName = (value) => Boolean(normalizeBoardName(value));

  function normalizePendingBoardName(value) {
    const match = String(value ?? "").trim().match(PENDING_PATTERN);
    return match ? `${match[1]} · 待编号 · ${match[2].trim()}` : null;
  }

  const isPendingBoardName = (value) => Boolean(normalizePendingBoardName(value));

  function displayKind(item) {
    const explicit = String(item?.displayKind ?? "").trim();
    if (aliases[explicit]) return aliases[explicit];
    const label = String(item?.displayLabel ?? item?.label ?? item?.boardDisplayName ?? "").trim();
    const labelKind = label.match(/^([^\s·]+)(?:\s|\s*·)/u)?.[1];
    if (aliases[labelKind]) return aliases[labelKind];
    const semantic = item?.operationKind ?? item?.inferenceKind ?? item?.factKind
      ?? item?.claimKind ?? item?.entryKind;
    return semanticKinds[semantic] ?? null;
  }

  function pendingBoardName(item) {
    const kind = displayKind(item);
    const short = String(mathematicalShortTitle(item) ?? "").trim();
    return kind && short ? `${kind} · 待编号 · ${short}` : null;
  }

  function freezeLedger(ledger) {
    const allocations = Object.freeze(Object.fromEntries(Object.entries(ledger.allocations)
      .map(([id, allocation]) => [id, Object.freeze({ ...allocation })])));
    return Object.freeze({
      schema: LEDGER_SCHEMA,
      projectId: ledger.projectId,
      highWaterMarks: Object.freeze({ ...ledger.highWaterMarks }),
      allocations,
    });
  }

  function validateLedger(value, expectedProjectId = null) {
    if (!value || typeof value !== "object" || value.schema !== LEDGER_SCHEMA) {
      throw new TypeError(`expected ${LEDGER_SCHEMA}`);
    }
    const projectId = String(value.projectId ?? "").trim();
    if (!projectId) throw new TypeError("numbering ledger projectId must be a non-empty string");
    if (expectedProjectId && projectId !== expectedProjectId) throw new Error("numbering ledger projectId mismatch");
    if (!value.allocations || typeof value.allocations !== "object" || Array.isArray(value.allocations)) {
      throw new TypeError("numbering ledger allocations must be an object");
    }
    if (!value.highWaterMarks || typeof value.highWaterMarks !== "object" || Array.isArray(value.highWaterMarks)) {
      throw new TypeError("numbering ledger highWaterMarks must be an object");
    }
    const highWaterMarks = {};
    Object.entries(value.highWaterMarks).forEach(([kind, number]) => {
      if (!Object.values(semanticKinds).includes(kind) || !Number.isInteger(number) || number < 0) {
        throw new Error(`invalid high-water mark: ${kind}=${number}`);
      }
      highWaterMarks[kind] = number;
    });
    const allocations = {};
    const occupied = new Set();
    Object.entries(value.allocations).forEach(([id, allocation]) => {
      if (!id.trim() || !allocation || typeof allocation !== "object") throw new Error("invalid numbering allocation");
      const { kind, number, state } = allocation;
      if (!Object.values(semanticKinds).includes(kind) || !Number.isInteger(number) || number < 1
        || !ALLOCATION_STATES.includes(state)) throw new Error(`invalid numbering allocation: ${id}`);
      const key = `${kind}:${number}`;
      if (occupied.has(key)) throw new Error(`duplicate durable display number: ${key}`);
      occupied.add(key);
      if ((highWaterMarks[kind] ?? 0) < number) throw new Error(`high-water mark is below allocation: ${key}`);
      allocations[id] = { kind, number, state };
    });
    return freezeLedger({ projectId, highWaterMarks, allocations });
  }

  function emptyLedger(projectId) {
    const id = String(projectId ?? "").trim();
    if (!id) throw new TypeError("numbering ledger projectId must be a non-empty string");
    return freezeLedger({ projectId: id, highWaterMarks: {}, allocations: {} });
  }

  function boardNameFromLedger(item, ledger) {
    const allocation = ledger?.allocations?.[item?.id];
    const short = String(mathematicalShortTitle(item) ?? "").trim();
    return allocation && short ? `${allocation.kind} · ${allocation.number} · ${short}` : null;
  }

  function applyNumberingTransitions({ projectId, objects, ledger = null, transitions = [] }) {
    if (!Array.isArray(objects) || !Array.isArray(transitions)) throw new TypeError("objects and transitions must be arrays");
    const byId = new Map();
    objects.forEach((item) => {
      const id = String(item?.id ?? "").trim();
      if (!id || byId.has(id)) throw new Error(`invalid or duplicate mathematical object id: ${id || "<empty>"}`);
      if (!displayKind(item) || !mathematicalShortTitle(item)) throw new Error(`mathematical object cannot be numbered: ${id}`);
      byId.set(id, item);
    });
    const current = ledger ? validateLedger(ledger, projectId) : emptyLedger(projectId);
    const allocations = Object.fromEntries(Object.entries(current.allocations).map(([id, allocation]) => [id, { ...allocation }]));
    const highWaterMarks = { ...current.highWaterMarks };
    const seenTransitions = new Set();
    const normalized = transitions.map((transition) => {
      const id = String(transition?.id ?? "").trim();
      const to = transition?.to;
      if (!id || seenTransitions.has(id) || !["accepted", "retired", "merged", "rejected"].includes(to)) {
        throw new Error(`invalid or duplicate numbering transition: ${id || "<empty>"}`);
      }
      seenTransitions.add(id);
      return { id, to };
    });
    normalized.filter((transition) => transition.to === "accepted").sort((left, right) => left.id.localeCompare(right.id)).forEach(({ id }) => {
      const item = byId.get(id);
      if (!item) throw new Error(`accepted object is missing from numbering input: ${id}`);
      const existing = allocations[id];
      if (existing?.state === "active") return;
      if (existing) throw new Error(`retired or merged number cannot be reactivated: ${id}`);
      const kind = displayKind(item);
      const number = (highWaterMarks[kind] ?? 0) + 1;
      highWaterMarks[kind] = number;
      allocations[id] = { kind, number, state: "active" };
    });
    normalized.filter((transition) => ["retired", "merged"].includes(transition.to)).forEach(({ id, to }) => {
      if (!allocations[id]) throw new Error(`${to} object has no durable number: ${id}`);
      allocations[id] = { ...allocations[id], state: to };
    });
    normalized.filter((transition) => transition.to === "rejected").forEach(({ id }) => {
      if (allocations[id]) throw new Error(`numbered object must be retired instead of rejected: ${id}`);
    });
    const nextLedger = freezeLedger({ projectId: current.projectId, highWaterMarks, allocations });
    const rejected = new Set(normalized.filter((transition) => transition.to === "rejected").map((transition) => transition.id));
    const namesById = Object.freeze(Object.fromEntries(objects.map((item) => [
      item.id,
      rejected.has(item.id) ? null : boardNameFromLedger(item, nextLedger) ?? pendingBoardName(item),
    ])));
    return Object.freeze({ ledger: nextLedger, namesById });
  }

  function transitionsFromAdmission(receipt) {
    if (receipt?.verdict !== "accepted" || !Array.isArray(receipt.acceptedObjectIds)) {
      throw new TypeError("accepted admission receipt with acceptedObjectIds is required");
    }
    return Object.freeze(receipt.acceptedObjectIds.map((id) => Object.freeze({ id, to: "accepted" })));
  }

  function searchAliases(item, boardName) {
    return Object.freeze([...new Set([
      normalizeBoardName(boardName) ?? normalizePendingBoardName(boardName), mathematicalShortTitle(item), item?.title, item?.fullTitle,
      item?.displayLabel, item?.label, item?.id,
    ].map((value) => typeof value === "string" ? value.trim() : "").filter(Boolean))]);
  }

  return Object.freeze({
    CAPABILITY_ID, LEGACY_CAPABILITY_ID, LEDGER_SCHEMA, ALLOCATION_STATES, CANONICAL_PATTERN, PENDING_PATTERN,
    mathematicalShortTitle, displayKind, composeBoardName, normalizeBoardName, isValidBoardName,
    normalizePendingBoardName, isPendingBoardName, pendingBoardName, emptyLedger, validateLedger,
    boardNameFromLedger, applyNumberingTransitions, transitionsFromAdmission, searchAliases,
  });
});

/* Stable input boundary for research trajectory bundles. */
(function publishTrajectoryContract(root, factory) {
  "use strict";

  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  if (root) root.CMathTrajectoryContract = contract;
})(typeof window !== "undefined" ? window : globalThis, function createTrajectoryContract() {
  "use strict";

  const arrayFields = ["entries", "infs", "nodes", "links", "b0"];
  const objectFields = ["states", "deriv", "prem", "succ"];
  const currentFields = ["state_id", "snapshot_id", "revision", "status", "pending"];

  function assertCurrent(bundle) {
    const current = bundle.current;
    if (!current || typeof current !== "object" || Array.isArray(current)) throw new TypeError("bundle.current must be an object");
    const unknown = Object.keys(current).filter(field => !currentFields.includes(field));
    if (unknown.length) throw new TypeError(`bundle.current has unknown field ${unknown[0]}`);
    for (const field of ["state_id", "snapshot_id"]) {
      if (typeof current[field] !== "string" || !current[field].trim()) throw new TypeError(`bundle.current.${field} must be a non-empty string`);
    }
    if (!Number.isSafeInteger(current.revision) || current.revision < 0) throw new TypeError("bundle.current.revision must be a non-negative safe integer");
    if (!current.status || typeof current.status !== "object" || Array.isArray(current.status)) throw new TypeError("bundle.current.status must be an object");
    const nodeIds = bundle.nodes.map(node => node?.id);
    const statusIds = Object.keys(current.status);
    if (new Set(nodeIds).size !== nodeIds.length || nodeIds.some(id => typeof id !== "string" || !id.trim()) || statusIds.length !== nodeIds.length || statusIds.some(id => !nodeIds.includes(id))) {
      throw new TypeError("bundle.current.status must cover exactly bundle.nodes");
    }
    for (const [id, status] of Object.entries(current.status)) {
      if (status !== "acc" && status !== "draft") throw new TypeError(`bundle.current.status.${id} must be acc or draft`);
    }
    if (!Array.isArray(current.pending)) throw new TypeError("bundle.current.pending must be an array");
    for (const item of current.pending) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("bundle.current.pending items must be objects");
      const fields = Object.keys(item);
      if (fields.some(field => !["draft_id", "message"].includes(field))) throw new TypeError("bundle.current.pending item has unknown field");
      for (const field of ["draft_id", "message"]) {
        if (typeof item[field] !== "string" || !item[field].trim()) throw new TypeError(`bundle.current.pending.${field} must be a non-empty string`);
      }
    }
    return current;
  }

  function assertBundle(bundle) {
    if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) throw new TypeError("bundle must be an object");
    for (const field of ["name", "title"]) {
      if (typeof bundle[field] !== "string" || !bundle[field].trim()) throw new TypeError(`bundle.${field} must be a non-empty string`);
    }
    for (const field of arrayFields) {
      if (!Array.isArray(bundle[field])) throw new TypeError(`bundle.${field} must be an array`);
    }
    for (const field of objectFields) {
      if (!bundle[field] || typeof bundle[field] !== "object" || Array.isArray(bundle[field])) throw new TypeError(`bundle.${field} must be an object`);
    }
    if (bundle.steps !== undefined && !Array.isArray(bundle.steps)) throw new TypeError("bundle.steps must be an array when present");
    if (bundle.current !== undefined) {
      if (Array.isArray(bundle.steps) && bundle.steps.length) throw new TypeError("bundle.current and non-empty bundle.steps are mutually exclusive");
      assertCurrent(bundle);
    }
    return bundle;
  }

  function hasReplay(bundle) {
    return Array.isArray(bundle?.steps) && bundle.steps.length > 0;
  }

  function hasCurrent(bundle) {
    return Boolean(bundle?.current);
  }

  return Object.freeze({ assertBundle, hasReplay, hasCurrent });
});

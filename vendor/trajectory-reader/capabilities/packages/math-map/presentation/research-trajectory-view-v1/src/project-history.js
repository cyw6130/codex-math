"use strict";

const { projectCurrent } = require("./project-current.js");

const PIN = ["state_id", "snapshot_id", "revision"];

function plain(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function clone(value) { return structuredClone(value); }
function pin(snapshot) { return Object.fromEntries(PIN.map(field => [field, snapshot[field]])); }
function same(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function routeProjection(snapshot, current) {
  const R = snapshot.R;
  const routes = Array.isArray(R?.routes) ? R.routes.map(route => route.id) : [];
  const focus = R?.focus ? {
    route: R.focus.route_ref.id,
    goal: R.focus.goal_ref.id,
    strategy: R.focus.strategy_ref.id,
  } : null;
  const goals = [];
  for (const route of R?.routes ?? []) {
    for (const goal of route.current_goal_refs ?? []) {
      const id = goal.id;
      if (!goals.some(item => item.id === id)) goals.push({ id, done: current.states[id] === "established" });
    }
  }
  return {
    routes,
    currentRoute: focus?.route ?? null,
    focus,
    goals,
    abandoned: (R?.routes ?? []).filter(route => route.lifecycle?.state === "withdrawn").map(route => route.id),
    strategies: {},
    obstacles: [],
    pendingR: [],
    acceptedR: [],
  };
}

function projectHistory(request) {
  if (!plain(request) || !Array.isArray(request.frames) || request.frames.length === 0) {
    throw new TypeError("projectHistory expects a non-empty frames array");
  }
  if (request.title !== undefined && (typeof request.title !== "string" || !request.title.trim())) {
    throw new TypeError("title must be a non-empty string when present");
  }
  const projected = request.frames.map((frame, index) => {
    if (!plain(frame) || typeof frame.id !== "string" || !frame.id.trim()) throw new TypeError(`frames[${index}].id must be a non-empty string`);
    if (typeof frame.action !== "string" || !frame.action.trim()) throw new TypeError(`frames[${index}].action must be a non-empty string`);
    const commit = frame.action === "commit-research" || frame.action === "Research Commit";
    if ((!commit && typeof frame.result_kind !== "string") || (typeof frame.result_kind === "string" && !frame.result_kind.trim())) throw new TypeError(`frames[${index}].result_kind is invalid`);
    if (typeof frame.summary !== "string") throw new TypeError(`frames[${index}].summary must be a string`);
    if (!plain(frame.snapshot) || !plain(frame.draft_graph)) throw new TypeError(`frames[${index}] requires snapshot and draft_graph`);
    const current = projectCurrent({ snapshot: frame.snapshot, draft_graph: frame.draft_graph, title: request.title });
    return { frame, current, pin: pin(frame.snapshot), route: routeProjection(frame.snapshot, current), commit };
  });
  const stateId = projected[0].pin.state_id;
  const frameIds = new Set();
  let revision = -1;
  for (const [index, item] of projected.entries()) {
    if (item.pin.state_id !== stateId) throw new TypeError(`frames[${index}] has a different state_id`);
    if (frameIds.has(item.frame.id)) throw new TypeError(`duplicate history frame id: ${item.frame.id}`);
    frameIds.add(item.frame.id);
    if (item.pin.revision < revision) throw new TypeError("history frame revisions must be non-decreasing");
    revision = item.pin.revision;
  }

  const entries = [], infs = [], nodes = [], links = [], b0 = new Set();
  const byId = new Map();
  const linkIds = new Set();
  for (const item of projected) {
    for (const entry of item.current.entries) {
      const old = byId.get(entry.id);
      if (old && !same(old, entry)) throw new TypeError(`history object changed identity: ${entry.id}`);
      if (!old) { byId.set(entry.id, entry); entries.push(entry); nodes.push({ id: entry.id, t: "e", c: entry.c }); }
    }
    for (const inference of item.current.infs) {
      const old = byId.get(inference.id);
      if (old && !same(old, inference)) throw new TypeError(`history object changed identity: ${inference.id}`);
      if (!old) { byId.set(inference.id, inference); infs.push(inference); nodes.push({ id: inference.id, t: "i" }); }
    }
    item.current.b0.forEach(id => b0.add(id));
    for (const link of item.current.links) {
      const key = `${link.source}\u0000${link.target}\u0000${link.r}`;
      if (!linkIds.has(key)) { linkIds.add(key); links.push(link); }
    }
  }
  const prem = {}, succ = {};
  for (const inference of infs) {
    for (const premise of inference.p) (succ[premise] ??= []).push({ inf: inference.id, to: inference.c });
    (prem[inference.c] ??= []).push({ inf: inference.id, k: inference.k, n: inference.p.length });
  }
  const allIds = nodes.map(node => node.id);
  let previous = {};
  const steps = projected.map((item, index) => {
    const present = new Set(item.current.nodes.map(node => node.id));
    const status = Object.fromEntries(allIds.map(id => [id, present.has(id) ? item.current.current.status[id] : "absent"]));
    const produced = allIds.filter(id => present.has(id) && previous[id] === undefined && status[id] !== "acc");
    const admitted = allIds.filter(id => status[id] === "acc" && previous[id] !== "acc");
    previous = Object.fromEntries([...present].map(id => [id, status[id]]));
    return {
      id: item.frame.id,
      a: item.commit ? "Research Commit" : (item.frame.action.startsWith("/") ? item.frame.action : `/${item.frame.action}`),
      o: item.frame.summary,
      res: item.frame.result_kind === "no_change" ? "no-change" : item.frame.result_kind,
      n: index + 1,
      i: produced,
      m: admitted,
      r: [],
      f: [],
      action: item.frame.action,
      summary: item.frame.summary,
      result_kind: item.frame.result_kind,
      current: clone(item.current.current),
      status,
      states: clone(item.current.states),
      deriv: clone(item.current.deriv),
      route: item.route,
    };
  });
  return {
    name: `research-history-${projected[0].pin.state_id}`,
    title: request.title ?? `Research History · ${projected[0].pin.state_id}`,
    entries, infs, nodes, links, b0: [...b0],
    states: clone(projected.at(-1).current.states),
    deriv: clone(projected.at(-1).current.deriv),
    prem,
    succ,
    steps,
  };
}

module.exports = Object.freeze({ projectHistory });

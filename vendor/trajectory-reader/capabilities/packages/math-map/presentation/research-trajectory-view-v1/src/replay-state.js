/* Pure visual replay projection derived from a validated trajectory bundle.
   This is presentation state, not authoritative Research State R. */
(function publishReplayState(root, factory) {
  "use strict";

  const contract = typeof module === "object" && module.exports
    ? require("./bundle-contract.js")
    : root && root.CMathTrajectoryContract;
  const replayState = factory(contract);
  if (typeof module === "object" && module.exports) module.exports = replayState;
  if (root) root.CMathReplayState = replayState;
})(typeof window !== "undefined" ? window : globalThis, function createReplayState(contract) {
  "use strict";

  function splitId(ids, rest) {
    let best = "";
    ids.forEach(id => {
      if (rest.startsWith(id) && id.length > best.length) best = id;
    });
    return best ? [best, rest.slice(best.length + 1)] : [rest, ""];
  }

  function applyRouteEffect(state, effect, accepted, ids, stepIndex) {
    if (effect.startsWith("Focus:")) {
      const [route, goal, strategy] = effect.slice(6).split("+");
      state.focus = { route, goal, strategy };
      state.currentRoute = route;
    } else if (effect.startsWith("Strategy:")) {
      const [goal, strategy] = splitId(ids, effect.slice(9));
      state.strategies[goal] = strategy;
    } else if (effect.startsWith("Obstacle:")) {
      if (!accepted) {
        const [inf, why] = splitId(ids, effect.slice(9));
        state.obstacles.push({ inf, why, step: stepIndex });
      }
    } else if (effect.startsWith("Route:")) {
      const [, id, verb] = effect.split(":");
      if (verb === "abandoned") state.abandoned.add(id);
      if (verb === "created" || verb === "active") {
        if (!state.routes.includes(id)) state.routes.push(id);
        state.currentRoute = id;
      }
    } else if (effect.startsWith("Goal:")) {
      const rest = effect.slice(5);
      if (rest.startsWith("remaining:moved-to:")) return;
      const [id, verb] = splitId(ids, rest);
      if (verb === "dropped") {
        state.goals = state.goals.filter(goal => goal.id !== id);
        if (state.focus && state.focus.goal === id) state.focus = null;
        return;
      }
      const goal = state.goals.find(candidate => candidate.id === id);
      if (verb === "established") {
        if (goal) goal.done = true;
        else state.goals.push({ id, done: true });
      } else if (!goal) state.goals.push({ id, done: false });
    }
  }

  function routeSet(bundle, focus, inferences) {
    const entries = new Set();
    const routeInferences = new Set();
    if (!focus) return { entries, inferences: routeInferences };
    const pending = [focus.goal];
    while (pending.length) {
      const id = pending.pop();
      if (entries.has(id)) continue;
      entries.add(id);
      (bundle.prem[id] || []).forEach(premise => {
        if (routeInferences.has(premise.inf)) return;
        routeInferences.add(premise.inf);
        inferences[premise.inf].p.forEach(parent => pending.push(parent));
      });
    }
    return { entries, inferences: routeInferences };
  }

  function stateAt(bundle, stepIndex) {
    contract.assertBundle(bundle);
    const exact = bundle.steps?.[Math.max(0, Math.min(bundle.steps.length - 1, Number(stepIndex) || 0))];
    if (exact?.current && exact.status) {
      const presentInfs = bundle.infs.filter(inference => exact.status[inference.id] !== "absent");
      const prem = Object.fromEntries(Object.entries(bundle.prem).map(([id, items]) => [id, items.filter(item => exact.status[item.inf] !== "absent")]));
      return {
        status: { ...exact.status }, produced: [...(exact.i ?? [])], route: routeSet({ prem }, exact.route?.focus ?? null, Object.fromEntries(presentInfs.map(inference => [inference.id, inference]))),
        obstacles: exact.route?.obstacles ?? [], goals: exact.route?.goals ?? [], focus: exact.route?.focus ?? null,
        fabIds: new Set(exact.f ?? []), revision: exact.current.revision,
        currentRoute: exact.route?.currentRoute ?? null, routes: [...(exact.route?.routes ?? [])],
        abandoned: new Set(exact.route?.abandoned ?? []), strategies: { ...(exact.route?.strategies ?? {}) },
        pendingR: [...(exact.route?.pendingR ?? [])], acceptedR: [...(exact.route?.acceptedR ?? [])],
        mathStates: { ...(exact.states ?? {}) }, deriv: { ...(exact.deriv ?? {}) },
      };
    }
    const status = {};
    const ids = new Set();
    const inferences = {};
    bundle.nodes.forEach(node => { status[node.id] = "absent"; });
    bundle.entries.forEach(entry => {
      ids.add(entry.id);
      if (entry.c === "fact" || bundle.b0.includes(entry.id)) status[entry.id] = "acc";
    });
    bundle.infs.forEach(inference => {
      ids.add(inference.id);
      inferences[inference.id] = inference;
    });

    const state = {
      status,
      produced: [],
      revision: 0,
      currentRoute: "R1",
      routes: ["R1"],
      abandoned: new Set(),
      goals: [],
      strategies: {},
      focus: null,
      obstacles: [],
      fabIds: new Set(),
      pendingR: [],
      acceptedR: [],
    };
    for (let index = 0; index <= stepIndex && index < bundle.steps.length; index++) {
      const step = bundle.steps[index];
      const commit = step.a === "Research Commit";
      step.m.forEach(id => {
        if (commit) status[id] = "acc";
        else if (status[id] !== "acc") status[id] = "draft";
      });
      if (commit) {
        state.revision++;
        const batch = state.pendingR.concat(step.r);
        batch.forEach(effect => applyRouteEffect(state, effect, true, ids, index));
        state.acceptedR = state.acceptedR.concat(batch.filter(effect => !effect.startsWith("Obstacle:")));
        state.pendingR = state.pendingR.filter(effect => effect.startsWith("Obstacle:"));
      } else {
        step.r.forEach(effect => {
          state.pendingR.push(effect);
          applyRouteEffect(state, effect, false, ids, index);
        });
      }
      step.f.forEach(id => state.fabIds.add(id));
      if (index === stepIndex) {
        state.produced = commit ? [] : step.i.slice();
      }
    }

    return {
      status,
      produced: state.produced,
      route: routeSet(bundle, state.focus, inferences),
      obstacles: state.obstacles,
      goals: state.goals,
      focus: state.focus,
      fabIds: state.fabIds,
      revision: state.revision,
      currentRoute: state.currentRoute,
      routes: state.routes,
      abandoned: state.abandoned,
      strategies: state.strategies,
      pendingR: state.pendingR,
      acceptedR: state.acceptedR,
    };
  }

  function commitGroups(bundle) {
    contract.assertBundle(bundle);
    const groups = [];
    let current = { steps: [], fab: false };
    bundle.steps.forEach((step, index) => {
      current.steps.push(index);
      if (step.f.length || step.a === "/reconsider-route") current.fab = true;
      if (step.a === "Research Commit") {
        current.label = step.o;
        groups.push(current);
        current = { steps: [], fab: false };
      }
    });
    if (current.steps.length) {
      current.label = "尚未结算";
      groups.push(current);
    }
    return groups;
  }

  return Object.freeze({ stateAt, commitGroups });
});

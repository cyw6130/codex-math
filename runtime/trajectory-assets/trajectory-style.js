/* Node and link appearance for the replay canvas, ported from the
   math-research-workbench map page. Two rules carry the whole design:
     solid = in M, hollow = not yet;
     amber = what this step just added (its nodes and its edges).
   Mathematical status is copied from the bundle; nothing is judged here. */
(function publishTrajectoryStyle(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CMathTrajectoryStyle = api;
})(typeof window !== "undefined" ? window : globalThis, function createTrajectoryStyleApi() {
  "use strict";

  const endpointId = value => (typeof value === "object" && value !== null ? value.id : value);

  function hexA(color, alpha) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
    if (!match) return color;
    const n = parseInt(match[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function truncate(text, max = 18) {
    const value = String(text ?? "");
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }

  function createStyler(bundle, getState, palette) {
    const entries = new Map(bundle.entries.map(entry => [entry.id, entry]));
    const inferences = new Map(bundle.infs.map(inference => [inference.id, inference]));
    const foundations = new Set(bundle.b0);

    const producedSet = state => {
      const ids = new Set(state.produced);
      // The entry an inference concludes is part of what this step added.
      (state.exactProduced ? [] : state.produced).forEach(id => {
        const inference = inferences.get(id);
        if (inference) ids.add(inference.c);
      });
      return ids;
    };

    function nodeStyle(node) {
      const state = getState();
      const status = state.status[node.id] ?? "absent";
      const dim = status === "absent";
      const dash = status === "draft" || state.fabIds.has(node.id);
      const current = producedSet(state).has(node.id);
      const inference = inferences.get(node.id);

      if (inference || node.t === "i") {
        const proof = (inference?.k ?? "proof") === "proof";
        return {
          shape: "diamond",
          radius: dim ? 3.4 : 5,
          stroke: current ? palette.produced : dim ? palette.line2 : palette.inferenceStroke,
          fill: dim ? "transparent" : current ? palette.produced : proof ? palette.inferenceFill : palette.background,
          alpha: current ? 1 : dim ? 0.3 : 1,
          lineWidth: dim ? 1 : 1.4,
          dash,
          label: dim ? "" : truncate(inference?.t ?? `证明 · ${inference?.p.length ?? 0} 前提`, 32),
          labelColor: palette.inferenceTitle,
        };
      }

      const entry = entries.get(node.id);
      const isFact = entry?.c === "fact";
      // B₀ borrows the Fact colour at Claim size: one symbol fewer than a ring.
      const isFoundation = state.b0 ? state.b0.includes(node.id) : foundations.has(node.id);
      const mathState = isFact ? null : (state.mathStates ?? bundle.states)[node.id];
      let stroke = palette.factStroke;
      let fill = palette.factFill;
      if (!isFact && !isFoundation) {
        if (mathState === "established") { stroke = palette.claimEstablishedStroke; fill = palette.claimEstablishedFill; }
        else if (mathState === "refuted") { stroke = palette.bad; fill = palette.background; }
        else { stroke = palette.claimOpen; fill = palette.background; }
      }
      if (current) { stroke = palette.produced; fill = palette.produced; }

      return {
        shape: "circle",
        radius: dim ? 3.2 : isFact && !isFoundation ? 4.8 : 6,
        stroke: dim ? palette.line2 : stroke,
        fill: dim ? "transparent" : fill,
        alpha: dim ? 0.34 : 1,
        lineWidth: dim ? 1 : 1.6,
        dash,
        label: dim ? "" : truncate(entry?.t ?? node.id, 32),
        labelColor: isFact || isFoundation ? palette.ink2 : palette.ink,
      };
    }

    function linkStyle(link) {
      const state = getState();
      const inferenceId = link.relation === "premise" ? endpointId(link.target) : endpointId(link.source);
      const current = state.produced.includes(inferenceId);
      const lit = (state.status[inferenceId] ?? "absent") !== "absent";
      return {
        color: current ? palette.produced : lit ? hexA(palette.ink2, 0.85) : hexA(palette.line2, 0.28),
        width: current ? 2.4 : lit ? 1.1 : 0.7,
      };
    }

    return Object.freeze({ nodeStyle, linkStyle });
  }

  return Object.freeze({ createStyler, hexA, truncate });
});

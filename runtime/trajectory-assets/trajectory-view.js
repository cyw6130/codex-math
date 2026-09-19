/* Browser assembly for the research trajectory replay view. */
(function publishTrajectoryView(root, factory) {
  "use strict";
  const load = path => typeof module === "object" && module.exports ? require(path) : null;
  const view = factory(
    root?.CMathTrajectoryContract ?? load("./bundle-contract.js"),
    root?.CMathReplayState ?? load("./replay-state.js"),
    root?.CMathTrajectoryStyle ?? load("./trajectory-style.js"),
    root,
  );
  if (typeof module === "object" && module.exports) module.exports = view;
  if (root) root.CMathTrajectoryView = view;
})(typeof window !== "undefined" ? window : globalThis, function createTrajectoryView(contract, replay, style, root) {
  "use strict";

  const KIND_CN = { definition: "定义", algorithm: "算法", calculation: "计算", lemma: "引理", proposition: "命题", theorem: "定理", proof: "证明", organization: "组织" };
  const ACT_CN = { "/explore-research": "Exploration", "/orient-research": "Orientation", "/advance-research": "Advance", "/reconsider-route": "Reconsideration", "Research Commit": "Research Commit", Unclassified: "未唯一归类" };
  const esc = value => String(value ?? "").replace(/[&<>"]/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);

  function mount(container, bundle) {
    contract.assertBundle(bundle); // Trust boundary: deliberately before any DOM access.
    if (!container || typeof container.querySelector !== "function") throw new TypeError("container must be a DOM element");
    if (!root?.CMathTrajectoryCanvas?.create) throw new Error("CMathTrajectoryCanvas must load before CMathTrajectoryView");

    const q = selector => {
      const element = container.querySelector(selector);
      if (!element) throw new Error(`trajectory page is missing ${selector}`);
      return element;
    };
    const entries = new Map(bundle.entries.map(entry => [entry.id, entry]));
    const inferences = new Map(bundle.infs.map(inference => [inference.id, inference]));
    const replaying = contract.hasReplay(bundle);
    const currentMode = contract.hasCurrent(bundle);
    let destroyed = false;
    let resizeObserver = null;
    let step = 0;
    let selected = null;
    let acceptedOnly = false;
    let state = replaying ? replay.stateAt(bundle, 0) : {
      status: currentMode ? { ...bundle.current.status } : Object.fromEntries(bundle.nodes.map(node => [node.id, "acc"])),
      produced: [], route: { entries: new Set(), inferences: new Set() }, fabIds: new Set(bundle.nodes.filter(node => node.fab).map(node => node.id)),
      revision: currentMode ? bundle.current.revision : 0,
    };

    const layout = {
      nodes: bundle.nodes.map(node => {
        const inference = inferences.get(node.id);
        const entry = entries.get(node.id);
        return inference || node.t === "i" ? {
          id: node.id, nodeKind: "inference", title: inference?.t ?? "证明",
          operationKind: inference?.k ?? "proof",
        } : {
          id: node.id, nodeKind: "entry", title: entry?.t ?? node.id, displayName: entry?.t ?? node.id,
          entryKind: entry?.k, isFact: entry?.c === "fact", isClaim: entry?.c === "claim",
          isFoundation: bundle.b0.includes(node.id), claimState: bundle.states[node.id],
        };
      }),
      edges: bundle.links.map(link => ({ source: link.source, target: link.target, relation: link.r === "p" ? "premise" : "conclusion" })),
    };
    const css = root.getComputedStyle?.(container);
    const token = name => css?.getPropertyValue(name).trim() || undefined;
    const palette = {
      background: "#181818",
      produced: "#d6a84a",
      bad: token("--bad") ?? "#d9645b",
      ink: token("--ink") ?? "#e4ecf1",
      ink2: token("--ink-2") ?? "#b9c9d3",
      line2: token("--line-2") ?? "#2c3f4b",
      factFill: token("--math-map-fact"), factStroke: token("--math-map-fact-stroke"),
      claimOpen: token("--math-map-claim-open"),
      claimEstablishedFill: token("--math-map-claim-established"), claimEstablishedStroke: token("--math-map-claim-established-stroke"),
      inferenceFill: token("--math-map-inference"), inferenceStroke: token("--math-map-inference-stroke"), inferenceTitle: token("--math-map-inference-title"),
    };
    Object.keys(palette).forEach(key => palette[key] === undefined && delete palette[key]);

    const mathHTML = text => root.CMathDocument.inline(text);
    const documentHTML = text => root.CMathDocument.render(text);

    const document = root?.document ?? container.ownerDocument;
    const stage = q("#stage");
    q("#legend").textContent = "点击节点查看完整名称";
    const stageTitle = stage.querySelector(".selection-title") ?? (() => {
      if (!document?.createElement) return null;
      const element = document.createElement("div");
      element.className = "selection-title";
      element.setAttribute("aria-live", "polite");
      stage.append(element);
      return element;
    })();
    const objectTitle = id => inferences.has(id) ? (inferences.get(id).t ?? id) : (entries.get(id)?.t ?? id);
    const showStageTitle = id => { if (stageTitle) stageTitle.innerHTML = mathHTML(objectTitle(id)); };

    function setTab(which) {
      const routeTab = container.querySelector("#tabR");
      const routePane = container.querySelector("#paneR");
      if (routeTab) routeTab.setAttribute("aria-selected", String(which === "R"));
      if (routePane) routePane.hidden = which !== "R";
      q("#tabD").setAttribute("aria-selected", String(which === "D"));
      q("#paneD").hidden = which !== "D";
    }

    function statusText(id) {
      return state.status[id] === "acc" ? "已收录" : state.status[id] === "draft" ? "在研究草稿图里，尚未结算" : "当前步尚未出现";
    }

    function objectButton(id, title = objectTitle(id)) {
      return `<button class="jump" type="button" data-obj="${esc(id)}">${mathHTML(title)}</button>`;
    }

    function showObject(id, switchTab = true) {
      const entry = entries.get(id), inference = inferences.get(id), item = entry ?? inference;
      if (!item || (currentMode && acceptedOnly && state.status[id] === "draft")) return;
      if (state.mathStates && state.status[id] === "absent") return;
      showStageTitle(id);
      const witness = (state.deriv ?? bundle.deriv)[id];
      const mathState = (state.mathStates ?? state.states ?? bundle.states)[id];
      const status = inference ? (inference.k === 'proof' ? '证明推理' : '组织关系') : entry.c === 'fact' ? '基础事实' : ({established:'已建立',open:'开放',refuted:'已否定',inconsistent:'存在冲突'}[mathState] ?? mathState ?? '开放');
      const present = value => !state.mathStates || state.status[value] !== 'absent';
      const previous = inference ? inference.p : (bundle.prem[id] ?? []).map(x=>x.inf).filter(present);
      const next = inference ? [inference.c] : [...new Set((bundle.succ[id] ?? []).filter(x=>present(x.inf)).map(x=>x.to))];
      const basis = witness?.basis === 'b0' ? '<p class="none">当前语境直接采用的基础命题。</p>' : witness?.basis === 'negation' ? '<p class="none">由否定命题建立依据：</p>'+objectButton(witness.negatingClaimEntryId) : '';
      const source = `<details class="object-source"><summary>来源与标识</summary>${item.sourceTitle ? '<p>'+mathHTML(item.sourceTitle)+'</p>' : ''}<code>${esc(item.sourceId ?? id)}</code></details>`;
      q('#paneD').innerHTML = `<div class="object-kind">${esc(inference ? 'Inference' : entry.c === 'claim' ? 'Claim' : 'Fact')} · ${esc(status)}</div>
        <h4>${mathHTML(item.t)}</h4>
        <div class="math-document">${documentHTML(entry ? entry.s : inference.a)}</div>
        ${basis}
        <h5>${inference ? '全部前提' : '直接推理'}</h5>${previous.map(x=>objectButton(x)).join('') || '<p class="none">没有直接前提。</p>'}
        <h5>${inference ? '结论' : '直接后续'}</h5>${next.map(x=>objectButton(x)).join('') || '<p class="none">没有直接后续。</p>'}${source}`;
      if (selected !== id) q('#paneD').scrollTop = 0;
      selected = id;
      graph.setSelected(id);
      if (switchTab) setTab('D');
    }

    function renderRoute() {
      const goalTitle = id => entries.get(id)?.t ?? id;
      const focus = state.focus ? `<div class="row acc"><b>${esc(state.focus.route)}</b> → ${esc(goalTitle(state.focus.goal))}<span class="id">Strategy ${esc(state.focus.strategy)} · Goal ${esc(state.focus.goal)}</span></div>` : '<p class="none">Focus = null。</p>';
      const routes = state.routes.map(route => `<div class="row ${state.abandoned.has(route) ? "bad" : route === state.currentRoute ? "acc" : ""}">${esc(route)}${state.abandoned.has(route) ? " · 已放弃" : route === state.currentRoute ? " · 当前" : ""}</div>`).join("");
      const goals = state.goals.length ? state.goals.map(goal => `<div class="row ${goal.done ? "acc" : ""}"><span class="tag ${goal.done ? "acc" : "draft"}">${goal.done ? "established" : "推进中"}</span>${esc(goalTitle(goal.id))}<span class="id">${esc(goal.id)}</span></div>`).join("") : '<p class="none">还没有 Goal。</p>';
      const obstacles = state.obstacles.length ? state.obstacles.map(item => `<div class="row draft"><span class="tag draft">draft</span>${esc(item.why)}<span class="id">受阻于 ${esc(item.inf)}</span></div>`).join("") : '<p class="none">目前没有受阻记录。</p>';
      const counts = Object.values(state.status);
      q("#paneR").innerHTML = `<div class="sec">当前定向 <i>Focus</i></div>${focus}<div class="sec">Route <i>${state.routes.length} 条</i></div><div class="rows">${routes}</div><div class="sec">Goal <i>${state.goals.length} 个</i></div><div class="rows">${goals}</div><div class="sec">障碍 <i>草稿</i></div><div class="rows">${obstacles}</div><div class="sec">已结算 <i>revision ${state.revision}</i></div><div class="rows"><div class="row acc">M 中已接纳 ${counts.filter(value => value === "acc").length} 个对象</div><div class="row draft">草稿图里待结算 ${counts.filter(value => value === "draft").length} 个</div></div>`;
    }

    function renderTimeline() {
      q("#tl").innerHTML = replay.commitGroups(bundle).map(group => `<div class="grp${group.fab ? " fab" : ""}" style="flex-grow:${group.steps.length}"><span>${group.fab ? "假目标 · " : ""}${esc(String(group.label).slice(0, 22))}</span><div class="ticks">${group.steps.map(index => { const item = bundle.steps[index]; const classes = [index === step ? "cur" : index < step ? "done" : "", item.res === "no-change" ? "fail" : ""].filter(Boolean).join(" "); return `<button type="button" data-go-to="${index}" class="${classes}" title="第 ${index + 1} 步 · ${esc(ACT_CN[item.a] ?? item.a)}"></button>`; }).join("")}</div></div>`).join("");
      const current = bundle.steps[step];
      const kind = current.a === "Research Commit" ? "commit" : current.res === "no-change" ? "fail" : current.a === "/reconsider-route" ? "recon" : "";
      const projection = current.p && ((current.p.alternatives ?? []).length || current.p.tension || current.p.composite) ? `<span class="projection">${current.p.composite ? "复合片段 · " : ""}${(current.p.alternatives ?? []).length ? `候选：${current.p.alternatives.map(action => esc(ACT_CN[action] ?? action)).join(" / ")} · ` : ""}${esc(current.p.tension)}</span>` : "";
      q("#now").innerHTML = `<span class="act ${kind}">${esc(ACT_CN[current.a] ?? current.a)}${current.res === "no-change" ? " · No-change" : ""}</span><span class="obj">${esc(current.o)}</span><span class="pos mono">第 ${current.n} / ${bundle.steps.length} 步 · revision ${state.revision}</span>${projection}`;
    }

    const styler = style.createStyler(bundle, () => state, palette);
    const graph = root.CMathTrajectoryCanvas.create(q("#fgHost"), {
      window: root,
      palette,
      nodeStyle: styler.nodeStyle,
      isFramed: node => (state.status[node.id] ?? "absent") !== "absent",
      linkStyle: styler.linkStyle,
      onNodeClick: showObject,
      onBackgroundClick: () => { selected = null; graph.setSelected(null); if (replaying) setTab("R"); },
    });
    const visibleLayout = () => {
      if (!currentMode || !acceptedOnly) return layout;
      const visible = new Set(layout.nodes.filter(node => state.status[node.id] === "acc").map(node => node.id));
      return { nodes: layout.nodes.filter(node => visible.has(node.id)), edges: layout.edges.filter(edge => visible.has(edge.source) && visible.has(edge.target)) };
    };
    graph.setData(visibleLayout());
    if (typeof root?.ResizeObserver === "function") {
      resizeObserver = new root.ResizeObserver(() => { if (destroyed) return; graph.resize(); graph.fit(0); });
      resizeObserver.observe(container);
    }
    // Framing is driven by the engine settling, not by a timer.

    function repaint() {
      graph.repaint();
      if (selected && state.mathStates && state.status[selected] === "absent") {
        selected = null; graph.setSelected(null);
        if (stageTitle) stageTitle.textContent = "";
        q("#paneD").innerHTML = '<p class="none">当前步尚未出现此对象。</p>';
      } else if (selected) showObject(selected, false);
    }

    const applyAcceptedOnly = () => {
      if (acceptedOnly && selected && state.status[selected] === "draft") {
        selected = null;
        graph.setSelected(null);
        if (stageTitle) stageTitle.textContent = "";
        q("#paneD").innerHTML = '<p class="none">点击图中对象查看详情。</p>';
      }
      graph.setData(visibleLayout());
    };

    function goTo(index) {
      if (!replaying) return;
      step = Math.max(0, Math.min(bundle.steps.length - 1, Number(index) || 0));
      state = replay.stateAt(bundle, step);
      renderTimeline();
      renderRoute();
      repaint();
    }

    if (replaying) {
      renderTimeline();
      renderRoute();
    } else {
      q("footer").remove();
      q("#tabR").remove();
      q("#paneR").remove();
      setTab("D");
    }
    const currentSummary = currentMode ? `<span class="chip">revision <b>${bundle.current.revision}</b></span><span class="chip">M <b>${Object.values(state.status).filter(value => value === "acc").length}</b></span><span class="chip">draft <b>${Object.values(state.status).filter(value => value === "draft").length}</b></span>${bundle.current.pending.length ? `<span class="chip warn pending-hint" title="${esc(bundle.current.pending.map(item => item.message).join("；"))}">待处理 · ${esc(bundle.current.pending.length === 1 ? bundle.current.pending[0].message : `${bundle.current.pending.length} 项 · ${bundle.current.pending[0].message}`)}</span>` : ""}` : "";
    const profile = q("#profile");
    profile.innerHTML = `<span class="chip">Entry <b>${bundle.entries.length}</b></span><span class="chip">Claim <b>${bundle.entries.filter(entry => entry.c === "claim").length}</b></span><span class="chip">Inference <b>${bundle.infs.length}</b></span>${replaying ? `<span class="chip">步 <b>${bundle.steps.length}</b></span><span class="chip warn">无新增 <b>${bundle.steps.filter(item => item.res === "no-change").length}</b></span>` : currentSummary}`;
    if (currentMode && document?.createElement) {
      const fitButton = document.createElement("button");
      fitButton.id = "fit";
      fitButton.type = "button";
      fitButton.className = "fit-current";
      fitButton.textContent = "适配画布";
      profile.append(fitButton);
      const label = document.createElement("label");
      label.className = "current-filter";
      label.textContent = "只看已接纳";
      const input = document.createElement("input");
      input.id = "acceptedOnly";
      input.type = "checkbox";
      input.setAttribute("type", "checkbox");
      input.setAttribute("aria-label", "只看已接纳");
      label.append(input);
      profile.append(label);
    }

    const click = event => {
      const target = event.target.closest?.("[data-go],[data-go-to],[data-obj],#tabR,#tabD,#reset,#end,#fit");
      if (!target) return;
      if (target.id === "tabR" || target.id === "tabD") setTab(target.id.slice(-1));
      else if (target.id === "reset") goTo(0);
      else if (target.id === "end") goTo(bundle.steps.length - 1);
      else if (target.id === "fit") graph.fit();
      else if (target.dataset?.go) goTo(step + Number(target.dataset.go));
      else if (target.dataset?.goTo) goTo(Number(target.dataset.goTo));
      else if (target.dataset?.obj) { showObject(target.dataset.obj); graph.focusNode(target.dataset.obj); }
    };
    const keydown = event => {
      if (!replaying || event.target?.tagName === "SELECT") return;
      const next = { ArrowRight: step + 1, ArrowLeft: step - 1, Home: 0, End: bundle.steps.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      goTo(next);
    };
    container.addEventListener("click", click);
    container.addEventListener("keydown", keydown);
    const change = event => { if (event.target?.id !== "acceptedOnly") return; acceptedOnly = Boolean(event.target.checked); applyAcceptedOnly(); };
    container.addEventListener("change", change);

    return Object.freeze({
      container,
      goTo,
      destroy() { destroyed = true; resizeObserver?.disconnect(); container.removeEventListener("click", click); container.removeEventListener("keydown", keydown); container.removeEventListener("change", change); graph.destroy(); },
    });
  }

  return Object.freeze({ mount });
});

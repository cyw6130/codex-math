/* CMath Math Map consumer bridge for canonical mixed-text math rendering. */
(() => {
  "use strict";

  const base = window.GammaMath;
  if (!base?.render || base.consumerAdapterId) return;

  const explicitMath = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+\$|\\\([\s\S]+?\\\))/g;
  const mathCandidate = /[A-Za-z\u0370-\u03ff\\][A-Za-z0-9\u0370-\u03ff\\{}_[\](),:+\-*/=<>|^⊗∈→∘∑∏±·∪⋯′⁻¹²³⁴⁵⁶⁷⁸⁹⁰₀-₉ \t]*/gu;
  const mathSignal = /\\[A-Za-z]+|[_^](?:\{|[A-Za-z0-9\u0370-\u03ff])|[=⊗∈→∘∑∏·∪⋯]/u;
  const hasCjk = /[\u3400-\u9fff]/u;

  function isExplicit(part) {
    return (part.startsWith("$$") && part.endsWith("$$"))
      || (part.startsWith("\\[") && part.endsWith("\\]"))
      || (part.startsWith("$") && part.endsWith("$"))
      || (part.startsWith("\\(") && part.endsWith("\\)"));
  }

  function shouldUseDisplayMath(formula) {
    return formula.length >= 32
      || /\\(?:bigoplus|bigcup|bigcap|sum|prod|int|frac|begin)\b/u.test(formula);
  }

  function normalizeFormulaOperators(formula) {
    return formula
      .replace(/(?<![\\{A-Za-z])coker\b(?!\})/gu, "\\operatorname{coker}")
      .replace(/(?<![\\{A-Za-z])dim\b(?!\})/gu, "\\dim")
      .replace(/(?<![\\{A-Za-z])ker\b(?!\})/gu, "\\ker")
      .replace(/(?<![\\{A-Za-z])im\b(?!\})/gu, "\\operatorname{im}")
      .replace(/(?<![\\{A-Za-z])tr\b(?!\})/gu, "\\operatorname{tr}");
  }

  function normalizeForRendering(value = "") {
    const source = String(value);
    if (!hasCjk.test(source)) return source;
    return source.split(explicitMath).map((part) => {
      if (isExplicit(part)) return part;
      return part.replace(mathCandidate, (candidate) => {
        if (!mathSignal.test(candidate)) return candidate;
        const leading = candidate.match(/^\s*/u)?.[0] ?? "";
        const trailing = candidate.match(/\s*$/u)?.[0] ?? "";
        const formula = normalizeFormulaOperators(
          candidate.slice(leading.length, candidate.length - trailing.length),
        );
        const delimiter = shouldUseDisplayMath(formula) ? "$$" : "$";
        return `${leading}${delimiter}${formula}${delimiter}${trailing}`;
      });
    }).join("");
  }

  const api = {
    capabilityId: base.capabilityId,
    consumerAdapterId: "cmath-math-map.math-rendering-consumer/v1",
    render(value = "", options = {}) {
      return base.render(options.mathOnly ? value : normalizeForRendering(value), options);
    },
    toPlainText(value = "") {
      return base.toPlainText(normalizeForRendering(value));
    },
    renderInto(element, value, options = {}) {
      if (!element) return null;
      element.innerHTML = api.render(value, options.displayMode
        ? { mathOnly: true, displayMode: true }
        : undefined);
      element.dataset.gammaMathRendered = "true";
      return element;
    },
    renderAll(root = document) {
      root.querySelectorAll?.("[data-gamma-math]:not([data-gamma-math-rendered])").forEach((element) => {
        api.renderInto(element, element.textContent, { displayMode: element.dataset.gammaMath === "block" });
      });
      return root;
    },
    renderInline(value = "") { return api.render(value); },
    renderBlock(value = "") { return api.render(value, { mathOnly: true, displayMode: true }); },
  };

  window.GammaMath = Object.freeze(api);
})();

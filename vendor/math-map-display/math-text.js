/**
 * @cmath-provenance
 * @package math-rendering-v1
 * @version v1
 * @canonicalSource packages/math-map/rendering/math-rendering-v1/browser-assets/math-text.js
 * @contentHash sha256:cb0a77ed4ad56c57ce029541334fc67063c0cd8356371bb369140b0d4b07de04
 * @syncAuthority CMath-capabilities/exports/canonical.json
 * @warning DO NOT EDIT DIRECTLY. Synchronize from CMath-capabilities.
 */
/* Gamma Math Rendering capability: one KaTeX-backed renderer for mixed mathematical text. */
(() => {
  "use strict";

  const CAPABILITY_ID = "cmath-gamma.math-rendering/v1";
  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[char]);
  const commands = {
    ell: "ℓ", theta: "θ", Theta: "Θ", Lambda: "Λ", lambda: "λ",
    delta: "δ", Delta: "Δ", sigma: "σ", Sigma: "Σ", tau: "τ", chi: "χ",
    alpha: "α", beta: "β", gamma: "γ", omega: "ω", Omega: "Ω",
    le: "≤", ge: "≥", neq: "≠", in: "∈", mapsto: "↦", to: "→",
    sum: "∑", prod: "∏", cdot: "·", times: "×", pm: "±",
    langle: "⟨", rangle: "⟩", circ: "∘", otimes: "⊗", partial: "∂",
  };
  const subscript = { 0: "₀", 1: "₁", 2: "₂", 3: "₃", 4: "₄", 5: "₅", 6: "₆", 7: "₇", 8: "₈", 9: "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", h: "ₕ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ", r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ" };
  const superscript = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ", n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ" };

  function scriptText(value, table, open, close) {
    const chars = Array.from(value);
    return chars.map((char) => table[char] ?? char).join("");
  }

  function latexToPlain(value = "") {
    return String(value)
      .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2")
      .replace(/\\(operatorname|mathrm|mathfrak|mathbf|text)\{([^{}]*)\}/g, "$2")
      .replace(/\\([A-Za-z]+)/g, (_, command) => commands[command] ?? command)
      .replace(/_\{([^{}]+)\}/g, (_, body) => scriptText(body, subscript, "₍", "₎"))
      .replace(/\^\{([^{}]+)\}/g, (_, body) => scriptText(body, superscript, "⁽", "⁾"))
      .replace(/_([^\s{}])/g, (_, body) => scriptText(body, subscript, "₍", "₎"))
      .replace(/\^([^\s{}])/g, (_, body) => scriptText(body, superscript, "⁽", "⁾"))
      .replace(/\\[,;!:\s]/g, "")
      .replace(/[{}]/g, "")
      .replace(/\\/g, "");
  }

  const explicitMath = /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+\$|\\\([\s\S]+?\\\))/g;
  const compatibilityCandidate = /[\(\[\{]?[A-Za-z\u0370-\u03ff\\][A-Za-z0-9\u0370-\u03ff\\{}_[\](),.;:+\-*/=<>|^⊗∈→∘∑∏±·∪⋯′⁻¹²³⁴⁵⁶⁷⁸⁹⁰₀-₉]*/gu;
  const compatibilitySignal = /\\[A-Za-z]+|[_^](?:\{|[A-Za-z0-9\u0370-\u03ff])|[=⊗∈→∘∑∏·∪⋯]/u;

  function isExplicitMath(part) {
    return (part.startsWith("$$") && part.endsWith("$$"))
      || (part.startsWith("\\[") && part.endsWith("\\]"))
      || (part.startsWith("$") && part.endsWith("$"))
      || (part.startsWith("\\(") && part.endsWith("\\)"));
  }

  function normalizeInput(text = "") {
    return String(text).split(explicitMath).map((part) => {
      if (isExplicitMath(part)) return part;
      return part.replace(compatibilityCandidate, (candidate) => (
        compatibilitySignal.test(candidate) ? `$${candidate}$` : candidate
      ));
    }).join("");
  }

  function mathPart(part) {
    if (part.startsWith("$$")) return { math: part.slice(2, -2), displayMode: true };
    if (part.startsWith("\\[")) return { math: part.slice(2, -2), displayMode: true };
    if (part.startsWith("$")) return { math: part.slice(1, -1), displayMode: false };
    return { math: part.slice(2, -2), displayMode: false };
  }

  function renderFormula(math, displayMode) {
    if (!window.katex) return escapeHtml(latexToPlain(math));
    try {
      return window.katex.renderToString(math, { throwOnError: false, displayMode, trust: false });
    } catch {
      return escapeHtml(latexToPlain(math));
    }
  }

  function render(text = "", options = {}) {
    const source = String(text);
    if (options.mathOnly) {
      const normalized = isExplicitMath(source) ? mathPart(source).math : source;
      return renderFormula(normalized, options.displayMode !== false);
    }
    return normalizeInput(source).split(explicitMath).map((part) => {
      if (!isExplicitMath(part)) return escapeHtml(part);
      const { math, displayMode } = mathPart(part);
      return renderFormula(math, displayMode);
    }).join("");
  }

  function toPlainText(text = "") {
    return normalizeInput(text).split(explicitMath).map((part) => (
      isExplicitMath(part) ? latexToPlain(mathPart(part).math) : part
    )).join("");
  }

  function renderInto(element, text, options = {}) {
    if (!element) return null;
    element.innerHTML = render(text, options.displayMode
      ? { mathOnly: true, displayMode: true }
      : undefined);
    element.dataset.gammaMathRendered = "true";
    return element;
  }

  function renderAll(root = document) {
    root.querySelectorAll?.("[data-gamma-math]:not([data-gamma-math-rendered])").forEach((element) => {
      renderInto(element, element.textContent, { displayMode: element.dataset.gammaMath === "block" });
    });
    return root;
  }

  // Compatibility aliases for older callers. New consumers use render().
  const renderInline = (text = "") => render(text);
  const renderBlock = (math = "") => render(math, { mathOnly: true, displayMode: true });

  window.GammaMath = Object.freeze({
    capabilityId: CAPABILITY_ID,
    render,
    renderInto,
    renderAll,
    toPlainText,
    renderInline,
    renderBlock,
  });
})();

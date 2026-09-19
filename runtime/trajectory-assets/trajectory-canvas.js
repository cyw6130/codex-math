/* Self-contained replay canvas, ported from the math-research-workbench map page.
   It owns drawing only: the caller supplies a style for every node and link, so
   this file never decides what a mathematical object means. */
(function publishTrajectoryCanvas(root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CMathTrajectoryCanvas = api;
})(typeof window !== "undefined" ? window : globalThis, function createTrajectoryCanvasApi() {
  "use strict";

  const endpointId = value => (typeof value === "object" && value !== null ? value.id : value);

  function hexA(color, alpha) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
    if (!match) return color;
    const n = parseInt(match[1], 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  function create(container, options = {}) {
    const win = options.window ?? (typeof window !== "undefined" ? window : globalThis);
    if (typeof win.ForceGraph !== "function") throw new Error("ForceGraph must load before the trajectory canvas");

    const nodeStyleOf = options.nodeStyle ?? (() => ({}));
    const linkStyleOf = options.linkStyle ?? (() => ({}));
    const palette = options.palette ?? {};
    let selectedId = null;
    let destroyed = false;
    let paintScale = 1;

    const host = (win.document ?? container.ownerDocument).createElement("div");
    host.className = "trajectory-canvas-host";
    host.setAttribute("style", "position:absolute;inset:0");
    container.appendChild(host);

    const graph = win.ForceGraph()(host)
      .backgroundColor(palette.background ?? "#181818")
      .nodeId("id")
      .nodeLabel(() => "")
      .nodeRelSize(6)
      .nodeVal(node => (node.nodeKind === "inference" || node.t === "i") ? 1 : 2)
      .cooldownTicks(160)
      .enableNodeDrag(true)
      .nodeCanvasObjectMode(() => "replace")
      .nodeCanvasObject(paintNode)
      .nodePointerAreaPaint((node, color, ctx) => {
        if (options.isFramed && !options.isFramed(node)) return;
        const s = nodeStyleOf(node);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(node.x, node.y, ((s.radius ?? 6) + 3) / paintScale, 0, Math.PI * 2);
        ctx.fill();
      })
      .linkColor(link => linkStyleOf(link).color ?? hexA(palette.line2 ?? "#2c3f4b", 0.28))
      .linkWidth(link => linkStyleOf(link).width ?? 0.7)
      .linkDirectionalArrowLength(link => link.relation === "conclusion" ? 3.5 : 0)
      .linkDirectionalArrowRelPos(1)
      .linkDirectionalArrowColor(link => linkStyleOf(link).color ?? hexA(palette.line2 ?? "#2c3f4b", 0.28))
      .onNodeClick(node => options.onNodeClick?.(node.id))
      .onBackgroundClick(() => options.onBackgroundClick?.())
      .onEngineStop(() => { if (!destroyed) fitVisible(500); });

    function paintNode(node, ctx, scale) {
      const s = nodeStyleOf(node);
      // Radii are screen-space: dividing by scale keeps a node the same visual
      // size whatever the zoom, so a small map does not paint giant blobs.
      const safeScale = Math.max(scale, 0.1);
      paintScale = safeScale;
      const radius = (s.radius ?? 6) / safeScale;
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.beginPath();
      if (s.shape === "diamond") {
        ctx.moveTo(node.x, node.y - radius);
        ctx.lineTo(node.x + radius, node.y);
        ctx.lineTo(node.x, node.y + radius);
        ctx.lineTo(node.x - radius, node.y);
        ctx.closePath();
      } else {
        ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      }
      ctx.setLineDash(s.dash ? [3 / safeScale, 2.4 / safeScale] : []);
      ctx.fillStyle = s.fill ?? "transparent";
      ctx.fill();
      ctx.strokeStyle = s.stroke ?? "transparent";
      ctx.lineWidth = (s.lineWidth ?? 1.4) / safeScale;
      ctx.stroke();
      ctx.setLineDash([]);

      if (node.id === selectedId) {                    // 选中：双环，与本步新增的实心琥珀区分
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 6 / safeScale, 0, 2 * Math.PI);
        ctx.strokeStyle = palette.ink ?? "#e4ecf1";
        ctx.lineWidth = 2.4 / safeScale;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 9.5 / safeScale, 0, 2 * Math.PI);
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 1 / safeScale;
        ctx.stroke();
        ctx.globalAlpha = s.alpha ?? 1;
      }

      if (s.label && safeScale >= 2.2) {
        const size = Math.max(8, Math.min(13, 11 / Math.sqrt(safeScale)));
        ctx.font = `${size / safeScale}px "IBM Plex Sans","PingFang SC",system-ui,sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = s.labelColor ?? palette.ink ?? "#e4ecf1";
        ctx.fillText((win.GammaMath?.toPlainText(s.label) ?? s.label), node.x, node.y + radius + 3 / safeScale);
      }
      ctx.globalAlpha = 1;
    }

    // Frame what the reader can actually see. An object with no edges drifts far
    // from the cluster; letting it into the bounding box shrinks everything else
    // into a corner.
    const fitVisible = (duration = 420) => {
      if (destroyed) return;
      const inFrame = options.isFramed;
      graph.zoomToFit(duration, 60, inFrame ? node => inFrame(node) : undefined);
    };

    const resize = () => {
      if (destroyed) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 40 || bounds.height < 40) return;
      graph.width(bounds.width).height(bounds.height);
    };

    return {
      setData(layout) {
        graph.graphData({
          nodes: layout.nodes.map(node => ({ ...node })),
          links: layout.edges.map(edge => ({ ...edge, source: endpointId(edge.source), target: endpointId(edge.target) })),
        });
        resize();
      },
      repaint() { graph.nodeCanvasObject(paintNode); },
      setSelected(id) { selectedId = id; graph.nodeCanvasObject(paintNode); },
      fit(duration = 420) { fitVisible(duration); },
      focusNode(id) {
        const node = graph.graphData().nodes.find(item => item.id === id);
        if (!node) return;
        selectedId = id;
        graph.centerAt(node.x ?? 0, node.y ?? 0, 420);
        graph.zoom(Math.max(1.6, graph.zoom()), 420);
      },
      resize,
      destroy() { destroyed = true; graph.pauseAnimation?.(); host.remove(); },
    };
  }

  return Object.freeze({ create, hexA });
});

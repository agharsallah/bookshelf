/**
 * Paint one frame of the neighbourhood: faint ring guides, edges as bowed ink lines
 * with their relation's terminal mark, nodes by shape, then labels placed without
 * collisions in screen space. Pure with respect to its inputs: hovering redraws, it
 * never re-lays out.
 */
import { anchorLabel } from '../../lib/anchors';
import { controlPoint, quadAt, quadTangent, toScreen, type Camera, type Point } from './geometry';
import { placeLabels, shorten, type LabelCandidate } from './labels';
import type { Layout, SimNode } from './layout';
import { RING } from './layout';
import type { GraphModel, ModelEdge, ModelNode } from './model';
import type { GraphPalette } from './palette';
import { edgeWidth, KIND_STYLES, PROPOSED_DASH, RELATION_STYLES } from './styles';

export interface Scene {
  width: number;
  height: number;
  dpr: number;
  cam: Camera;
  model: GraphModel;
  layout: Layout;
  palette: GraphPalette;
  /** Hovered or keyboard-active node and its neighbours; everything else dims. */
  lit: ReadonlySet<string> | null;
  hoverEdge: string | null;
  selected: { kind: 'node' | 'edge'; id: string } | null;
}

let fonts: { read: string; ui: string } | null = null;

/** The UI's own families, read once from the tokens (they are plain names by then). */
function families(): { read: string; ui: string } {
  if (fonts) return fonts;
  const css = getComputedStyle(document.documentElement);
  fonts = {
    read: css.getPropertyValue('--font-read').trim() || 'Georgia, serif',
    ui: css.getPropertyValue('--font-ui').trim() || 'system-ui, sans-serif',
  };
  return fonts;
}

export function labelText(node: ModelNode): string {
  if (node.kind === 'node' && node.data.anchor) return anchorLabel(node.data.anchor);
  return shorten(node.label, node.depth === 0 ? 48 : 30);
}

function labelFont(node: ModelNode, focus: boolean): string {
  const { read: FONT_READ, ui: FONT_UI } = families();
  if (focus) return `600 16px ${FONT_READ}`;
  if (node.kind === 'concept') return `italic 400 13.5px ${FONT_READ}`;
  if (node.kind === 'document') return `500 13px ${FONT_READ}`;
  return `400 11.5px ${FONT_UI}`;
}

function alpha(color: string, a: number): string {
  // Computed colours arrive as rgb()/rgba(); canvas accepts color-mix-free rgba only.
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (!m?.[1]) return color;
  const [r, g, b] = m[1].split(/[\s,/]+/).filter(Boolean);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function drawRings(ctx: CanvasRenderingContext2D, s: Scene) {
  const rings = Math.max(...s.model.nodes.map((n) => n.depth), 0);
  ctx.save();
  ctx.strokeStyle = alpha(s.palette.rule, 0.8);
  ctx.lineWidth = 1 / s.cam.k;
  ctx.setLineDash([2 / s.cam.k, 6 / s.cam.k]);
  for (let d = 1; d <= rings; d += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, d * RING, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function terminal(ctx: CanvasRenderingContext2D, edge: ModelEdge, a: Point, c: Point, b: Point, target: SimNode, k: number, color: string) {
  const style = RELATION_STYLES[edge.relation];
  if (style.terminal === 'none') return;
  const size = 6 / k;
  let at: Point;
  let angle: number;
  if (style.terminal === 'equals') {
    // "Same as" is marked mid-line, where it reads as an equals sign across the edge.
    at = quadAt(a, c, b, 0.5);
    const tan = quadTangent(a, c, b, 0.5);
    angle = Math.atan2(tan.y, tan.x);
  } else {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.max(0.5, 1 - (target.r + 3) / len);
    at = quadAt(a, c, b, t);
    const tan = quadTangent(a, c, b, t);
    angle = Math.atan2(tan.y, tan.x);
  }
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(angle);
  ctx.setLineDash([]);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5 / k;
  ctx.beginPath();
  switch (style.terminal) {
    case 'arrow':
      ctx.moveTo(-size, -size * 0.6);
      ctx.lineTo(0, 0);
      ctx.lineTo(-size, size * 0.6);
      ctx.stroke();
      break;
    case 'bar':
      ctx.moveTo(0, -size * 0.8);
      ctx.lineTo(0, size * 0.8);
      ctx.stroke();
      break;
    case 'dot':
      ctx.arc(-size * 0.3, 0, size * 0.35, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'tick':
      ctx.arc(-size * 0.4, 0, size * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'equals':
      ctx.moveTo(-size * 0.3, -size * 0.6);
      ctx.lineTo(-size * 0.3, size * 0.6);
      ctx.moveTo(size * 0.3, -size * 0.6);
      ctx.lineTo(size * 0.3, size * 0.6);
      ctx.stroke();
      break;
  }
  ctx.restore();
}

function drawEdges(ctx: CanvasRenderingContext2D, s: Scene) {
  const k = s.cam.k;
  for (const edge of [...s.model.edges].reverse()) {
    const a = s.layout.byId.get(edge.source);
    const b = s.layout.byId.get(edge.target);
    if (!a || !b) continue;
    const selected = s.selected?.kind === 'edge' && s.selected.id === edge.id;
    const hovered = s.hoverEdge === edge.id;
    const dim = s.lit !== null && !(s.lit.has(edge.source) && s.lit.has(edge.target)) && !selected && !hovered;
    const color = alpha(s.palette.relations[edge.relation], dim ? 0.12 : selected || hovered ? 1 : 0.72);
    const c = controlPoint(a, b, edge.lane);
    const style = RELATION_STYLES[edge.relation];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = (edgeWidth(edge.strength, s.model.strongest) + (selected || hovered ? 1 : 0)) / k;
    ctx.setLineDash((edge.status === 'proposed' ? PROPOSED_DASH : style.dash).map((d) => d / k));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, b.x, b.y);
    ctx.stroke();
    ctx.restore();
    if (!dim || selected) terminal(ctx, edge, a, c, b, b, k, color);
  }
}

function nodePath(ctx: CanvasRenderingContext2D, n: SimNode) {
  const r = n.r;
  ctx.beginPath();
  switch (KIND_STYLES[n.kind].shape) {
    case 'ring':
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      break;
    case 'square':
      ctx.rect(n.x - r * 0.85, n.y - r * 0.85, r * 1.7, r * 1.7);
      break;
    case 'spine':
      ctx.roundRect(n.x - r * 0.55, n.y - r * 1.2, r * 1.1, r * 2.4, r * 0.2);
      break;
    case 'diamond':
      ctx.moveTo(n.x, n.y - r);
      ctx.lineTo(n.x + r, n.y);
      ctx.lineTo(n.x, n.y + r);
      ctx.lineTo(n.x - r, n.y);
      ctx.closePath();
      break;
  }
}

function drawNodes(ctx: CanvasRenderingContext2D, s: Scene) {
  const k = s.cam.k;
  const byId = new Map(s.model.nodes.map((n) => [n.id, n]));
  for (const sim of s.layout.nodes) {
    const node = byId.get(sim.id);
    if (!node) continue;
    const isFocus = sim.id === s.model.focus;
    const dim = s.lit !== null && !s.lit.has(sim.id);
    const color = alpha(s.palette.kinds[sim.kind], dim ? 0.3 : 1);
    const hollow = KIND_STYLES[sim.kind].shape === 'ring' || KIND_STYLES[sim.kind].shape === 'diamond';
    ctx.save();
    nodePath(ctx, sim);
    ctx.fillStyle = hollow && !isFocus ? s.palette.raised : color;
    ctx.fill();
    ctx.lineWidth = (isFocus ? 2.5 : 2) / k;
    ctx.strokeStyle = hollow ? color : alpha(s.palette.raised, 0.9);
    ctx.stroke();
    if (sim.kind === 'document') {
      ctx.fillStyle = s.palette.raised;
      ctx.fillRect(sim.x - sim.r * 0.55, sim.y - sim.r * 0.55, sim.r * 1.1, 1.5 / k);
    }
    if (s.selected?.kind === 'node' && s.selected.id === sim.id) {
      ctx.beginPath();
      ctx.arc(sim.x, sim.y, sim.r + 5 / k + 2, 0, Math.PI * 2);
      ctx.strokeStyle = s.palette.accent;
      ctx.lineWidth = 2 / k;
      ctx.stroke();
    }
    if (node.more > 0 && !dim) drawMore(ctx, sim, k, s.palette.ink3);
    ctx.restore();
  }
}

/** Three small dots pointing away from the centre: "there is more this way". */
function drawMore(ctx: CanvasRenderingContext2D, n: SimNode, k: number, color: string) {
  const len = Math.hypot(n.x, n.y) || 1;
  const ux = n.x / len;
  const uy = n.y / len;
  ctx.fillStyle = color;
  for (let i = 1; i <= 3; i += 1) {
    const d = n.r + (4 + i * 3.5) / k;
    ctx.beginPath();
    ctx.arc(n.x + ux * d, n.y + uy * d, 1.1 / k, 0, Math.PI * 2);
    ctx.fill();
  }
}

function priority(node: ModelNode, s: Scene): number {
  if (node.id === s.model.focus) return 1000;
  if (s.selected?.kind === 'node' && s.selected.id === node.id) return 900;
  const lit = s.lit?.has(node.id) ? 400 : 0;
  return lit + (node.depth === 1 ? 200 : 100) + node.weight * 20 + node.degree + (node.kind === 'concept' ? 10 : 0);
}

const widths = new WeakMap<Layout, Map<string, number>>();

function drawLabels(ctx: CanvasRenderingContext2D, s: Scene) {
  const cache = widths.get(s.layout) ?? new Map<string, number>();
  widths.set(s.layout, cache);
  const candidates: (LabelCandidate & { node: ModelNode; text: string; font: string })[] = [];
  for (const node of s.model.nodes) {
    const sim = s.layout.byId.get(node.id);
    if (!sim) continue;
    const focus = node.id === s.model.focus;
    const font = labelFont(node, focus);
    const text = labelText(node);
    const key = `${font}|${text}`;
    let width = cache.get(key);
    if (width === undefined) {
      ctx.font = font;
      width = ctx.measureText(text).width;
      cache.set(key, width);
    }
    const p = toScreen(sim, s.cam);
    candidates.push({ id: node.id, x: p.x, y: p.y, r: sim.r * s.cam.k + 2, width, height: focus ? 18 : 15, priority: priority(node, s), node, text, font });
  }
  const placed = placeLabels(candidates, { width: s.width, height: s.height });
  const byId = new Map(candidates.map((c) => [c.id, c]));
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const p of placed) {
    const c = byId.get(p.id);
    if (!c) continue;
    const dim = s.lit !== null && !s.lit.has(p.id);
    ctx.font = c.font;
    ctx.lineWidth = 4;
    ctx.strokeStyle = alpha(s.palette.paper, 0.9);
    ctx.fillStyle = dim ? s.palette.ink3 : c.node.kind === 'node' ? s.palette.ink2 : s.palette.ink;
    const y = p.y + p.height / 2;
    ctx.strokeText(c.text, p.x, y);
    ctx.fillText(c.text, p.x, y);
  }
}

export function drawScene(ctx: CanvasRenderingContext2D, s: Scene): void {
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  ctx.clearRect(0, 0, s.width, s.height);
  ctx.setTransform(s.dpr * s.cam.k, 0, 0, s.dpr * s.cam.k, s.dpr * s.cam.x, s.dpr * s.cam.y);
  drawRings(ctx, s);
  drawEdges(ctx, s);
  drawNodes(ctx, s);
  ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
  drawLabels(ctx, s);
}

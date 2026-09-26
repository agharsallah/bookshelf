/**
 * The canvas, driven imperatively: layout, camera, animation loop, pointer input and
 * drawing. React hands it data (`setModel`, `setSelected`, `setPalette`) and hears back
 * through callbacks; hover and zoom never go through React state, so moving the pointer
 * costs one redraw and never a re-layout.
 *
 * Motion: the first picture is settled off-screen and drawn finished. After that
 * (re-focus, show more, depth) the simulation ticks on animation frames until it
 * cools, then the loop stops. On a re-focus the camera first compensates for the shift (nothing jumps), then glides
 * to the new centre. With reduced motion the layout is settled off-screen and drawn once.
 *
 * What is laid out, and how it is framed, is the `LayoutKit`'s: the neighbourhood's rings
 * by default, the map's free layout (`../atlas/layout`) there. A kit may `bloom`: the
 * first picture is still settled off-screen, then grows out from the centre into place.
 * A lens change (`setLens`) cross-fades what is dimmed; `glideTo` brings a node to the
 * middle; after a change that reshapes the picture the camera refits once it settles,
 * unless you have moved it yourself in the meantime.
 */
import { centerOn, edgeAt, nodeAt, toWorld, zoomAt, type Camera, type Point } from './geometry';
import { createLayout, positionsOf, recentre, RING, seedPositions, settle, type Layout, type Positions } from './layout';
import { neighbours, type GraphModel } from './model';
import type { GraphPalette } from './palette';
import { drawScene, type Lens } from './draw';

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

type AnyModel = GraphModel<unknown, unknown>;

export interface LayoutKit {
  /** A stopped simulation over `model`, starting from `known` positions where it can. */
  create(model: AnyModel, known: Positions): Layout;
  /** The camera that frames the picture in a `width × height` viewport. */
  fit(model: AnyModel, layout: Layout, width: number, height: number): Camera;
  /** Dotted guides at each ring's radius. */
  rings: boolean;
  /** Grow the first picture out from the centre instead of drawing it finished. */
  bloom: boolean;
}

/** One focal node pinned at the origin, its rings at depth × RING. */
export const NEIGHBOURHOOD_KIT: LayoutKit = {
  create: (model, known) => createLayout(model, seedPositions(model, known)),
  fit: (model, _layout, width, height) => {
    const depth = Math.max(1, ...model.nodes.map((n) => n.depth));
    const span = depth * RING + 70;
    const k = Math.max(0.4, Math.min(1.3, Math.min(width, height) / 2 / span));
    return centerOn({ x: 0, y: 0 }, width || 1, height || 1, k);
  },
  rings: true,
  bloom: false,
};

export interface ControllerEvents {
  onSelect: (selection: Selection) => void;
  onFocusRequest: (nodeId: string) => void;
}

const TWEEN_MS = 520;
const BLOOM_MS = 900;
const LENS_MS = 280;
const CLICK_SLOP = 4;

const easeOut = (t: number) => 1 - (1 - t) ** 3;

export class GraphController {
  private model: AnyModel | null = null;
  private layout: Layout | null = null;
  private palette: GraphPalette | null = null;
  private selected: Selection = null;
  private hoverNode: string | null = null;
  private hoverEdge: string | null = null;
  private external: string | null = null;
  private cam: Camera = { x: 0, y: 0, k: 1 };
  private tween: { from: Camera; to: Camera; start: number } | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private reduced = false;
  private drag: { start: Point; cam: Camera; moved: boolean } | null = null;
  private bloom: { start: number; to: Map<string, Point> } | null = null;
  private lens: Lens | null = null;
  private lensFade: { from: Lens | null; start: number } | null = null;
  /** Frame the picture again once the simulation cools (cleared by a pan or zoom). */
  private refit = false;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly detach: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: ControllerEvents,
    private kit: LayoutKit = NEIGHBOURHOOD_KIT,
  ) {
    this.ctx = canvas.getContext('2d');
    this.detach = this.listen();
    // Labels are measured in the web fonts: draw again once they have loaded.
    void document.fonts?.ready.then(() => this.request());
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.layout?.simulation.stop();
    this.detach();
  }

  setPalette(palette: GraphPalette | null): void {
    this.palette = palette;
    this.request();
  }

  setSelected(selection: Selection): void {
    this.selected = selection;
    this.request();
  }

  /** Light a node and its neighbours from outside the canvas (list focus). */
  setHighlight(id: string | null): void {
    this.external = id;
    this.request();
  }

  /** Dim what the lens leaves out, fading from the previous lens. */
  setLens(lens: Lens | null): void {
    if (lens === this.lens) return;
    this.lensFade = this.reduced ? null : { from: this.lens, start: performance.now() };
    this.lens = lens;
    this.request();
  }

  /** Swap how the picture is laid out (the map's grouping), reflowing from where it is. */
  setKit(kit: LayoutKit): void {
    if (kit === this.kit) return;
    this.kit = kit;
    if (!this.model || !this.layout) return;
    const known = positionsOf(this.layout);
    this.layout.simulation.stop();
    this.layout = kit.create(this.model, known);
    this.reflow();
  }

  /** Glide the camera until `id` sits in the middle, zooming in a little if far out. */
  glideTo(id: string): void {
    const node = this.layout?.byId.get(id);
    if (!node || this.width === 0) return;
    this.refit = false;
    const to = centerOn(node, this.width, this.height, Math.max(this.cam.k, 1.1));
    this.tween = this.reduced ? null : { from: this.cam, to, start: performance.now() };
    if (this.reduced) this.cam = to;
    this.request();
  }

  resize(width: number, height: number, dpr: number): void {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    if (first) this.cam = this.fit();
    this.request();
  }

  setModel(model: AnyModel, reducedMotion: boolean): void {
    const previous = this.layout ? positionsOf(this.layout) : new Map<string, Point>();
    const refocus = this.model !== null && this.model.focus !== model.focus;
    let known: Map<string, Point> = previous;
    if (refocus) {
      const origin = previous.get(model.focus) ?? { x: 0, y: 0 };
      known = recentre(previous, model.focus);
      // Shift the camera by the same amount so the picture holds still…
      this.cam = { ...this.cam, x: this.cam.x + origin.x * this.cam.k, y: this.cam.y + origin.y * this.cam.k };
    }
    this.layout?.simulation.stop();
    this.model = model;
    this.reduced = reducedMotion;
    this.layout = this.kit.create(model, known);
    this.hoverNode = null;
    this.hoverEdge = null;
    if (reducedMotion || previous.size === 0) {
      // First paint (and reduced motion): settle off-screen, draw the finished picture…
      settle(this.layout);
      this.cam = this.fit();
      this.tween = null;
      // …or, for a kit that blooms, grow it out from the centre into those places.
      if (!reducedMotion && previous.size === 0 && this.kit.bloom) this.startBloom();
    } else if (refocus) {
      // …then glide to the new centre while the layout reflows.
      this.tween = { from: this.cam, to: this.fit(), start: performance.now() };
    } else {
      this.refit = true; // show more, a filter: frame the new picture once it settles
    }
    this.request();
  }

  private reflow(): void {
    if (!this.layout) return;
    if (this.reduced) {
      settle(this.layout);
      this.cam = this.fit();
    } else {
      this.layout.simulation.alpha(0.7);
      this.refit = true;
    }
    this.request();
  }

  private startBloom(): void {
    if (!this.layout) return;
    const to = positionsOf(this.layout);
    for (const n of this.layout.nodes) {
      n.x *= 0.04;
      n.y *= 0.04;
    }
    this.bloom = { start: performance.now(), to };
  }

  zoomBy(factor: number): void {
    this.tween = null;
    this.refit = false;
    this.cam = zoomAt(this.cam, { x: this.width / 2, y: this.height / 2 }, factor);
    this.request();
  }

  resetView(): void {
    this.refit = false;
    const to = this.fit();
    this.tween = this.reduced ? null : { from: this.cam, to, start: performance.now() };
    if (this.reduced) this.cam = to;
    this.request();
  }

  private fit(): Camera {
    if (!this.model || !this.layout) return centerOn({ x: 0, y: 0 }, this.width || 1, this.height || 1, 1);
    // Mid-bloom, frame where the marks are going, not where they are.
    const to = this.bloom?.to;
    const layout = to ? { ...this.layout, nodes: this.layout.nodes.map((n) => ({ ...n, ...to.get(n.id) })) } : this.layout;
    return this.kit.fit(this.model, layout, this.width || 1, this.height || 1);
  }

  private request(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame((now) => {
      this.frame = 0;
      this.step(now);
    });
  }

  private step(now: number): void {
    let busy = false;
    const sim = this.layout?.simulation;
    if (this.bloom && this.layout) {
      const t = Math.min(1, (now - this.bloom.start) / BLOOM_MS);
      // Farther nodes set out a little later, so the picture unfolds rather than zooms.
      const reach = Math.max(1, ...[...this.bloom.to.values()].map((p) => Math.hypot(p.x, p.y)));
      for (const n of this.layout.nodes) {
        const to = this.bloom.to.get(n.id);
        if (!to) continue;
        const delay = 0.35 * (Math.hypot(to.x, to.y) / reach);
        const e = easeOut(Math.max(0, Math.min(1, (t - delay) / (1 - delay))));
        n.x = to.x * (0.04 + 0.96 * e);
        n.y = to.y * (0.04 + 0.96 * e);
      }
      if (t >= 1) this.bloom = null;
      busy = true;
    } else if (sim && !this.reduced && sim.alpha() >= sim.alphaMin()) {
      sim.tick(sim.alpha() > 0.3 ? 2 : 1);
      busy = true;
      if (sim.alpha() < sim.alphaMin() && this.refit) {
        this.refit = false;
        this.tween = { from: this.cam, to: this.fit(), start: now };
      }
    }
    if (this.lensFade && now - this.lensFade.start >= LENS_MS) this.lensFade = null;
    if (this.lensFade) busy = true;
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / TWEEN_MS);
      const e = 1 - (1 - t) ** 3;
      const { from, to } = this.tween;
      this.cam = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      if (t >= 1) this.tween = null;
      else busy = true;
    }
    this.draw();
    if (busy) this.request();
  }

  private draw(): void {
    if (!this.ctx || !this.model || !this.layout || !this.palette || this.width === 0) return;
    const lightFrom = this.hoverNode ?? this.external;
    drawScene(this.ctx, {
      width: this.width,
      height: this.height,
      dpr: this.dpr,
      cam: this.cam,
      model: this.model,
      layout: this.layout,
      palette: this.palette,
      lit: lightFrom ? neighbours(this.model, lightFrom) : null,
      hoverEdge: this.hoverEdge,
      selected: this.selected,
      rings: this.kit.rings,
      lens: this.lens,
      lensFrom: this.lensFade?.from ?? null,
      lensT: this.lensFade ? Math.min(1, (performance.now() - this.lensFade.start) / LENS_MS) : 1,
    });
  }

  private pointer(event: PointerEvent | MouseEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** What is under a screen point: a node first, then an edge. */
  hit(screen: Point): Selection {
    if (!this.layout || !this.model) return null;
    const world = toWorld(screen, this.cam);
    const node = nodeAt(world, this.layout.nodes, 6 / this.cam.k);
    if (node) return { kind: 'node', id: node };
    const edges = this.model.edges.flatMap((e) => {
      const a = this.layout?.byId.get(e.source);
      const b = this.layout?.byId.get(e.target);
      return a && b ? [{ id: e.id, a, b, lane: e.lane }] : [];
    });
    const edge = edgeAt(world, edges, 6 / this.cam.k);
    return edge ? { kind: 'edge', id: edge } : null;
  }

  private listen(): () => void {
    const c = this.canvas;
    const down = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      this.tween = null;
      this.refit = false;
      this.drag = { start: this.pointer(e), cam: this.cam, moved: false };
    };
    const move = (e: PointerEvent) => {
      const p = this.pointer(e);
      if (this.drag) {
        const dx = p.x - this.drag.start.x;
        const dy = p.y - this.drag.start.y;
        if (Math.hypot(dx, dy) > CLICK_SLOP) this.drag.moved = true;
        if (this.drag.moved) {
          this.cam = { ...this.drag.cam, x: this.drag.cam.x + dx, y: this.drag.cam.y + dy };
          this.request();
        }
        return;
      }
      const hit = this.hit(p);
      const node = hit?.kind === 'node' ? hit.id : null;
      const edge = hit?.kind === 'edge' ? hit.id : null;
      c.style.cursor = hit ? 'pointer' : 'grab';
      if (node !== this.hoverNode || edge !== this.hoverEdge) {
        this.hoverNode = node;
        this.hoverEdge = edge;
        this.request();
      }
    };
    const up = (e: PointerEvent) => {
      const drag = this.drag;
      this.drag = null;
      if (drag && !drag.moved) this.events.onSelect(this.hit(this.pointer(e)));
    };
    const leave = () => {
      if (this.hoverNode || this.hoverEdge) {
        this.hoverNode = null;
        this.hoverEdge = null;
        this.request();
      }
    };
    const dbl = (e: MouseEvent) => {
      const hit = this.hit(this.pointer(e));
      if (hit?.kind === 'node') this.events.onFocusRequest(hit.id);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.tween = null;
      this.refit = false;
      this.cam = zoomAt(this.cam, this.pointer(e), Math.exp(-e.deltaY * 0.0015));
      this.request();
    };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointerleave', leave);
    c.addEventListener('dblclick', dbl);
    c.addEventListener('wheel', wheel, { passive: false });
    return () => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up);
      c.removeEventListener('pointerleave', leave);
      c.removeEventListener('dblclick', dbl);
      c.removeEventListener('wheel', wheel);
    };
  }
}

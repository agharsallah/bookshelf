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
 */
import { centerOn, edgeAt, nodeAt, toWorld, zoomAt, type Camera, type Point } from './geometry';
import { createLayout, positionsOf, recentre, RING, seedPositions, settle, type Layout } from './layout';
import { neighbours, type GraphModel } from './model';
import type { GraphPalette } from './palette';
import { drawScene } from './draw';

export type Selection = { kind: 'node' | 'edge'; id: string } | null;

export interface ControllerEvents {
  onSelect: (selection: Selection) => void;
  onFocusRequest: (nodeId: string) => void;
}

const TWEEN_MS = 520;
const CLICK_SLOP = 4;

export class GraphController {
  private model: GraphModel | null = null;
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
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly detach: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: ControllerEvents,
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

  setModel(model: GraphModel, reducedMotion: boolean): void {
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
    this.layout = createLayout(model, seedPositions(model, known));
    this.hoverNode = null;
    this.hoverEdge = null;
    const target = this.fit();
    if (reducedMotion || previous.size === 0) {
      // First paint (and reduced motion): settle off-screen, draw the finished picture.
      settle(this.layout);
      this.cam = target;
      this.tween = null;
    } else if (refocus) {
      // …then glide to the new centre while the layout reflows.
      this.tween = { from: this.cam, to: target, start: performance.now() };
    }
    this.request();
  }

  zoomBy(factor: number): void {
    this.tween = null;
    this.cam = zoomAt(this.cam, { x: this.width / 2, y: this.height / 2 }, factor);
    this.request();
  }

  resetView(): void {
    const to = this.fit();
    this.tween = this.reduced ? null : { from: this.cam, to, start: performance.now() };
    if (this.reduced) this.cam = to;
    this.request();
  }

  private fit(): Camera {
    const depth = Math.max(1, ...(this.model?.nodes.map((n) => n.depth) ?? [1]));
    const span = depth * RING + 70;
    const k = Math.max(0.4, Math.min(1.3, Math.min(this.width, this.height) / 2 / span));
    return centerOn({ x: 0, y: 0 }, this.width || 1, this.height || 1, k);
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
    if (sim && !this.reduced && sim.alpha() >= sim.alphaMin()) {
      sim.tick(sim.alpha() > 0.3 ? 2 : 1);
      busy = true;
    }
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

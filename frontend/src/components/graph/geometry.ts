/**
 * Canvas geometry: the camera (pan + zoom), the gentle curve every edge is drawn as,
 * and hit-testing a pointer against nodes and edges. Everything is in world units
 * unless it says screen; the drawing code and the hit-tests share these functions so
 * what you click is exactly what you see.
 */

export interface Point {
  x: number;
  y: number;
}

/** screen = world × k + (x, y) */
export interface Camera {
  x: number;
  y: number;
  k: number;
}

export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 3;

export function toWorld(p: Point, cam: Camera): Point {
  return { x: (p.x - cam.x) / cam.k, y: (p.y - cam.y) / cam.k };
}

export function toScreen(p: Point, cam: Camera): Point {
  return { x: p.x * cam.k + cam.x, y: p.y * cam.k + cam.y };
}

/** Zoom by `factor` keeping the screen point `at` fixed. */
export function zoomAt(cam: Camera, at: Point, factor: number): Camera {
  const k = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.k * factor));
  const world = toWorld(at, cam);
  return { k, x: at.x - world.x * k, y: at.y - world.y * k };
}

/** A camera that puts world `center` in the middle of a `width × height` viewport. */
export function centerOn(center: Point, width: number, height: number, k: number): Camera {
  return { k, x: width / 2 - center.x * k, y: height / 2 - center.y * k };
}

/** A slight bow, like a hand-drawn marginal line; parallel edges fan out by lane. */
export const BASE_BEND = 0.1;
export const LANE_BEND = 0.22;

export function controlPoint(a: Point, b: Point, lane: number): Point {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const bend = BASE_BEND + lane * LANE_BEND;
  // Perpendicular of (b - a), scaled by its length: the bow is proportional.
  return { x: mx - (b.y - a.y) * bend, y: my + (b.x - a.x) * bend };
}

export function quadAt(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
}

/** Tangent direction at t (unnormalised). */
export function quadTangent(a: Point, c: Point, b: Point, t: number): Point {
  return { x: 2 * (1 - t) * (c.x - a.x) + 2 * t * (b.x - c.x), y: 2 * (1 - t) * (c.y - a.y) + 2 * t * (b.y - c.y) };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const SAMPLES = 16;

export function distanceToCurve(p: Point, a: Point, b: Point, lane: number): number {
  const c = controlPoint(a, b, lane);
  let best = Infinity;
  let prev = a;
  for (let i = 1; i <= SAMPLES; i += 1) {
    const next = quadAt(a, c, b, i / SAMPLES);
    best = Math.min(best, distanceToSegment(p, prev, next));
    prev = next;
  }
  return best;
}

export interface HitNode extends Point {
  id: string;
  r: number;
}

export interface HitEdge {
  id: string;
  a: Point;
  b: Point;
  lane: number;
}

/**
 * The node under a world point: the nearest whose disc (plus `slop`) contains it.
 * `slop` is in world units; pass screen slop ÷ zoom for a constant finger-sized target.
 */
export function nodeAt(p: Point, nodes: readonly HitNode[], slop = 0): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if (d <= n.r + slop && d < bestD) {
      best = n.id;
      bestD = d;
    }
  }
  return best;
}

/** The edge nearest a world point, within `tolerance` world units. Nodes win ties: test them first. */
export function edgeAt(p: Point, edges: readonly HitEdge[], tolerance: number): string | null {
  let best: string | null = null;
  let bestD = tolerance;
  for (const e of edges) {
    const d = distanceToCurve(p, e.a, e.b, e.lane);
    if (d <= bestD) {
      best = e.id;
      bestD = d;
    }
  }
  return best;
}

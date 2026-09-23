/**
 * Force layout over one neighbourhood (d3-force). The focus is pinned at the origin;
 * a radial force holds each ring on its circle (depth × RING); links, charge and
 * collision spread the rest. Positions of nodes seen before are carried over, so
 * re-focusing reflows the picture instead of scattering it.
 *
 * Deterministic: seeded jiggle and phyllotaxis-like starting spots, so the same data
 * lays out the same way. `settle` runs the simulation to convergence synchronously
 * (reduced motion, tests); `createLayout` returns a stopped simulation for the canvas
 * to drive with its own animation frame loop.
 */
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import type { EntityKind } from '../../lib/api/types/graph';
import type { GraphModel } from './model';
import { KIND_STYLES } from './styles';

export const RING = 130;

export interface SimNode extends SimulationNodeDatum {
  id: string;
  depth: number;
  kind: EntityKind;
  r: number;
  x: number;
  y: number;
}

export interface SimLink extends SimulationLinkDatum<SimNode> {
  id: string;
  strength: number;
}

export type Positions = ReadonlyMap<string, { x: number; y: number }>;

export interface Layout {
  nodes: SimNode[];
  links: SimLink[];
  byId: Map<string, SimNode>;
  simulation: Simulation<SimNode, SimLink>;
}

/** A small deterministic PRNG (LCG) for d3's jiggle. */
export function seeded(seed = 1): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function nodeRadius(kind: EntityKind, isFocus: boolean): number {
  const base = KIND_STYLES[kind].radius;
  return isFocus ? base + 4 : base;
}

export function createLayout(model: GraphModel, previous: Positions = new Map()): Layout {
  const byId = new Map<string, SimNode>();
  const perRing = new Map<number, number>();
  const nodes: SimNode[] = model.nodes.map((n) => {
    const isFocus = n.id === model.focus;
    const i = perRing.get(n.depth) ?? 0;
    perRing.set(n.depth, i + 1);
    const prev = previous.get(n.id);
    const angle = i * GOLDEN + n.depth * 0.7;
    const radius = n.depth * RING;
    const node: SimNode = {
      id: n.id,
      depth: n.depth,
      kind: n.kind,
      r: nodeRadius(n.kind, isFocus),
      x: isFocus ? 0 : (prev?.x ?? Math.cos(angle) * radius),
      y: isFocus ? 0 : (prev?.y ?? Math.sin(angle) * radius),
    };
    if (isFocus) {
      node.fx = 0;
      node.fy = 0;
    }
    byId.set(n.id, node);
    return node;
  });

  const strongest = model.strongest || 1;
  const links: SimLink[] = model.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, strength: e.strength / strongest }));

  const simulation = forceSimulation<SimNode, SimLink>(nodes)
    .randomSource(seeded(nodes.length))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => 70 + 40 * (1 - l.strength))
        .strength(0.12),
    )
    .force('charge', forceManyBody<SimNode>().strength(-320).distanceMax(RING * 3))
    .force('collide', forceCollide<SimNode>((d) => d.r + 16).strength(0.9))
    .force('ring', forceRadial<SimNode>((d) => d.depth * RING, 0, 0).strength((d) => (d.depth === 0 ? 0 : 0.8)))
    .stop();
  // Carried-over nodes are already placed: start cooler so they drift, not jump.
  if (previous.size > 0) simulation.alpha(0.5);
  return { nodes, links, byId, simulation };
}

/** Tick until the simulation cools. Returns the number of ticks run. */
export function settle(layout: Layout, maxTicks = 600): number {
  const sim = layout.simulation;
  sim.stop();
  let ticks = 0;
  while (sim.alpha() >= sim.alphaMin() && ticks < maxTicks) {
    sim.tick();
    ticks += 1;
  }
  return ticks;
}

export function positionsOf(layout: Layout): Map<string, { x: number; y: number }> {
  return new Map(layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

/**
 * Starting spots for a new model: known positions as they are, and each unseen node
 * next to the first known neighbour it has, fanned out a little by its index, so new
 * nodes grow out of the node that brought them in rather than dropping in from nowhere.
 */
export function seedPositions(model: GraphModel, known: Positions): Map<string, { x: number; y: number }> {
  const out = new Map(known);
  model.nodes.forEach((node, i) => {
    if (out.has(node.id)) return;
    const edge = model.edges.find((e) => (e.source === node.id && known.has(e.target)) || (e.target === node.id && known.has(e.source)));
    const anchor = edge ? known.get(edge.source === node.id ? edge.target : edge.source) : undefined;
    if (!anchor) return;
    const angle = i * GOLDEN;
    out.set(node.id, { x: anchor.x + Math.cos(angle) * 18, y: anchor.y + Math.sin(angle) * 18 });
  });
  return out;
}

/**
 * Carry positions over to a new focus: shift everything so the new focus sits at the
 * origin (where it will be pinned). Nodes the new view has not seen start next to the
 * nearest known neighbour, so they grow out of it.
 */
export function recentre(previous: Positions, focus: string): Map<string, { x: number; y: number }> {
  const origin = previous.get(focus) ?? { x: 0, y: 0 };
  return new Map([...previous].map(([id, p]) => [id, { x: p.x - origin.x, y: p.y - origin.y }]));
}

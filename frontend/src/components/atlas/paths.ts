/**
 * "How does X lead to Y?": the strongest chain of connections between two marks.
 *
 * Dijkstra over the atlas, undirected (a line can be walked either way; each hop keeps
 * which way it reads). A hop costs its connection type's base cost, less the stronger the
 * line is: typed relations between ideas are short steps, a chapter merely mentioning an
 * idea is a longer one, "shares ideas" longer than walking through the idea it summarises,
 * and a book's own structure the longest, so a path explains rather than hopping through
 * a book that contains everything. Passing *through* a book costs extra for the same reason. Proposed lines
 * count, at a premium: they are claims nobody has checked yet.
 */
import type { AtlasEdge, AtlasNode } from '../../lib/api/types/graph';
import type { LinkKind } from '../graph/styles';
import type { AtlasIndex } from './model';

export const HOP_COST: Record<LinkKind, number> = {
  same_as: 0.6,
  supports: 1,
  contradicts: 1,
  extends: 1,
  example_of: 1,
  defines: 1.2,
  echoes: 1.6,
  mentions: 1.8,
  // One paper citing another: a real link, but weaker than a typed relation between ideas.
  cites: 2,
  // A shares line summarises a walk through the concepts it names: walk them instead.
  shares: 3.5,
  contains: 4,
};
const THROUGH_A_BOOK = 6;
const PROPOSED = 1.5;

export interface Hop {
  from: AtlasNode;
  to: AtlasNode;
  edge: AtlasEdge;
  /** The line reads from `from` to `to` (its source is `from`). */
  forward: boolean;
}

export function hopCost(edge: AtlasEdge): number {
  const strength = edge.weight * Math.max(edge.evidence_count, 1);
  const base = HOP_COST[edge.relation] * (1 + 1 / (1 + strength));
  return edge.status === 'proposed' ? base * PROPOSED : base;
}

/** The cheapest chain of hops from `fromId` to `toId`, or null when none joins them. */
export function shortestPath(index: AtlasIndex, fromId: string, toId: string): Hop[] | null {
  if (!index.byId.has(fromId) || !index.byId.has(toId)) return null;
  if (fromId === toId) return [];
  const dist = new Map<string, number>([[fromId, 0]]);
  const back = new Map<string, { prev: string; edge: AtlasEdge }>();
  const done = new Set<string>();
  const open = new Set<string>([fromId]);
  while (open.size > 0) {
    let here = '';
    let best = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < best || (d === best && id < here)) [here, best] = [id, d];
    }
    open.delete(here);
    if (here === toId) break;
    done.add(here);
    const through = here !== fromId && index.byId.get(here)?.kind === 'document' ? THROUGH_A_BOOK : 0;
    for (const edge of index.lines.get(here) ?? []) {
      const next = edge.src === here ? edge.dst : edge.src;
      if (done.has(next)) continue;
      const d = best + through + hopCost(edge);
      if (d < (dist.get(next) ?? Infinity)) {
        dist.set(next, d);
        back.set(next, { prev: here, edge });
        open.add(next);
      }
    }
  }
  if (!back.has(toId)) return null;
  const hops: Hop[] = [];
  for (let at = toId; at !== fromId;) {
    const step = back.get(at);
    const from = step ? index.byId.get(step.prev) : undefined;
    const to = index.byId.get(at);
    if (!step || !from || !to) return null;
    hops.unshift({ from, to, edge: step.edge, forward: step.edge.src === from.id });
    at = step.prev;
  }
  return hops;
}

/** The ids a path lights: its marks and its lines. */
export function pathIds(hops: readonly Hop[]): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set<string>(hops.flatMap((h) => [h.from.id, h.to.id]));
  return { nodes, edges: new Set(hops.map((h) => h.edge.id)) };
}

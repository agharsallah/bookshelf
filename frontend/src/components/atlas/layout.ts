/**
 * How the map lays out (a `LayoutKit` for `GraphController`): a free force layout over
 * books, chapters and concepts, with no pinned centre and no rings.
 *
 * - Each book has a **home** on a circle; its chapters start beside it, and a concept
 *   starts at the average home of the books whose chapters name it, so ideas shared by
 *   two books begin between them.
 * - `group: 'free'` pulls everything gently toward the middle; `group: 'book'` pulls
 *   each node toward its home instead, so books become islands joined by the ideas they
 *   share.
 * - Marks grow with how connected a node is: a hub concept reads as one at a glance.
 * - Deterministic: a seeded jiggle, so the same shelf lays out the same way.
 *
 * The first picture is settled off-screen, then blooms out from the centre (`bloom`);
 * `fit` frames whatever the layout covers.
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation } from 'd3-force';
import type { AtlasEdge, AtlasNode } from '../../lib/api/types/graph';
import type { LayoutKit } from '../graph/controller';
import { centerOn, type Point } from '../graph/geometry';
import { seeded, type Layout, type Positions, type SimLink, type SimNode } from '../graph/layout';
import type { GraphModel } from '../graph/model';

export type Grouping = 'free' | 'book';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const PAD = 60;

/** A mark's radius in world units, by kind and how many lines touch it. */
export function atlasRadius(node: Pick<AtlasNode, 'kind' | 'degree'>): number {
  const grow = Math.sqrt(node.degree);
  if (node.kind === 'document') return 11;
  if (node.kind === 'chapter') return 4.5 + Math.min(4, grow * 0.6);
  return 5 + Math.min(8, grow * 1.1);
}

/** Where each book lives: one in the middle, several on a circle that grows with them. */
export function bookHomes(books: readonly string[]): Map<string, Point> {
  if (books.length === 1 && books[0]) return new Map([[books[0], { x: 0, y: 0 }]]);
  const radius = 180 * Math.sqrt(books.length);
  return new Map(
    books.map((id, i) => [
      id,
      {
        x: Math.cos((i / books.length) * 2 * Math.PI) * radius,
        y: Math.sin((i / books.length) * 2 * Math.PI) * radius,
      },
    ]),
  );
}

/** Each node's home: its book's, or for a concept the average home of its books. */
export function homesOf(model: GraphModel<AtlasNode, AtlasEdge>, books: Map<string, Point>): Map<string, Point> {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const pulls = new Map<string, Point[]>();
  for (const e of model.edges) {
    const a = byId.get(e.source)?.data;
    const b = byId.get(e.target)?.data;
    for (const [concept, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const home = other?.kind === 'chapter' && other.document ? books.get(other.document.id) : undefined;
      if (concept?.kind === 'concept' && home) pulls.set(concept.id, [...(pulls.get(concept.id) ?? []), home]);
    }
  }
  const out = new Map<string, Point>();
  for (const n of model.nodes) {
    const own = n.data.kind !== 'concept' && n.data.document ? books.get(n.data.document.id) : undefined;
    const many = pulls.get(n.id);
    const home =
      own ??
      (many
        ? {
            x: many.reduce((s, p) => s + p.x, 0) / many.length,
            y: many.reduce((s, p) => s + p.y, 0) / many.length,
          }
        : { x: 0, y: 0 });
    out.set(n.id, home);
  }
  return out;
}

const LINK_DISTANCE: Record<string, number> = {
  contains: 46,
  shares: 110,
  mentions: 80,
  defines: 58,
};

export function createAtlasLayout(model: GraphModel<AtlasNode, AtlasEdge>, known: Positions, group: Grouping): Layout {
  const books = bookHomes(model.nodes.filter((n) => n.data.kind === 'document').map((n) => n.data.document?.id ?? n.id));
  const homes = homesOf(model, books);
  const rand = seeded(model.nodes.length + 7);
  const byId = new Map<string, SimNode>();
  const nodes: SimNode[] = model.nodes.map((n, i) => {
    const home = homes.get(n.id) ?? { x: 0, y: 0 };
    const prev = known.get(n.id);
    const spread = n.data.kind === 'document' ? 0 : 30 + 14 * Math.sqrt(i);
    const node: SimNode = {
      id: n.id,
      depth: 1,
      kind: n.kind,
      r: atlasRadius(n.data),
      x: prev?.x ?? home.x + Math.cos(i * GOLDEN) * spread * (0.6 + 0.4 * rand()),
      y: prev?.y ?? home.y + Math.sin(i * GOLDEN) * spread * (0.6 + 0.4 * rand()),
    };
    byId.set(n.id, node);
    return node;
  });
  const strongest = model.strongest || 1;
  const links: SimLink[] = model.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    strength: Math.min(1, e.strength / strongest),
  }));
  const relation = new Map(model.edges.map((e) => [e.id, e.relation]));
  const pull = group === 'book' ? 0.14 : 0.035;
  const home = (d: SimNode) => (group === 'book' ? (homes.get(d.id) ?? { x: 0, y: 0 }) : { x: 0, y: 0 });

  const simulation: Simulation<SimNode, SimLink> = forceSimulation<SimNode, SimLink>(nodes)
    .randomSource(seeded(nodes.length))
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance((l) => LINK_DISTANCE[relation.get(l.id) ?? ''] ?? 66)
        .strength((l) => {
          const r = relation.get(l.id);
          if (r === 'contains') return 0.35;
          if (r === 'shares') return 0.03 + 0.05 * l.strength;
          if (r === 'mentions') return 0.04 + 0.08 * l.strength;
          return 0.12 + 0.2 * l.strength;
        }),
    )
    .force(
      'charge',
      forceManyBody<SimNode>()
        .strength((d) => (d.kind === 'document' ? -420 : -150))
        .distanceMax(520),
    )
    .force('collide', forceCollide<SimNode>((d) => d.r + 6).strength(0.9))
    .force('x', forceX<SimNode>((d) => home(d).x).strength(pull))
    .force('y', forceY<SimNode>((d) => home(d).y).strength(pull))
    .stop();
  if (known.size > 0) simulation.alpha(0.5);
  return { nodes, links, byId, simulation };
}

/** The camera that shows every mark, with room for labels, never zoomed past 1.4×. */
export function fitAll(layout: Layout, width: number, height: number) {
  if (layout.nodes.length === 0) return centerOn({ x: 0, y: 0 }, width, height, 1);
  const xs = layout.nodes.map((n) => n.x);
  const ys = layout.nodes.map((n) => n.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.max(0.3, Math.min(1.4, Math.min(width / (maxX - minX + 2 * PAD), height / (maxY - minY + 2 * PAD))));
  return centerOn({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, width, height, k);
}

/** One kit per grouping, so switching back and forth is a stable identity. */
const kits = new Map<Grouping, LayoutKit>();

export function atlasKit(group: Grouping): LayoutKit {
  let kit = kits.get(group);
  if (!kit) {
    kit = {
      create: (model, known) => createAtlasLayout(model as GraphModel<AtlasNode, AtlasEdge>, known, group),
      fit: (_model, layout, width, height) => fitAll(layout, width, height),
      rings: false,
      bloom: true,
    };
    kits.set(group, kit);
  }
  return kit;
}

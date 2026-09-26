/**
 * From `GET /graph/atlas` to what the map draws, through the lens (`./lens`).
 *
 * `indexAtlas` is built once per response: nodes by id, lines by node, and the books
 * each concept appears in (through the chapters that link to it). `buildAtlasModel` then
 * decides, for one lens, what is in play:
 *
 * - a **node** passes when its kind is kept, it belongs to a kept book (a concept: any of
 *   its books), and, with "cross-book only", a concept appears in two books or more;
 * - a **line** passes when its connection type is kept and both ends pass;
 * - when the lens narrows connections (or asks for cross-book ideas), a node stays lit
 *   only if a passing line touches it, so "contradicts" alone shows the ideas at odds,
 *   not every concept that happens to be a concept;
 * - a search lights the names that contain it and whatever a passing line joins them to.
 *
 * With `others: 'dim'` the model keeps everything and a `Lens` says what stays lit; with
 * `'hide'` the model holds only what is in play and the layout reflows around it.
 */
import type { Atlas, AtlasEdge, AtlasNode, EntityKind } from '../../lib/api/types/graph';
import type { Lens } from '../graph/draw';
import { shorten } from '../graph/labels';
import { edgeStrength, lanes, type GraphModel, type ModelEdge, type ModelNode } from '../graph/model';
import type { KindKey, LensFilters } from './lens';

export type AtlasModel = GraphModel<AtlasNode, AtlasEdge>;

export interface AtlasIndex {
  atlas: Atlas;
  byId: Map<string, AtlasNode>;
  /** Every line touching a node. */
  lines: Map<string, AtlasEdge[]>;
  /** Book ids a node belongs to: its own for books and chapters, its chapters' for concepts. */
  books: Map<string, Set<string>>;
  /** Books in shelf order, as the map lists them. */
  shelf: AtlasNode[];
}

export interface AtlasView {
  model: AtlasModel;
  /** What stays lit when others are dimmed; null when everything is. */
  lens: Lens | null;
  /** How much the lens lets through, out of everything. */
  shown: { nodes: number; edges: number };
  total: { nodes: number; edges: number };
}

const DRAWN_AS: Record<AtlasNode['kind'], EntityKind> = {
  document: 'document',
  chapter: 'node',
  concept: 'concept',
};

export function kindKey(node: AtlasNode): KindKey {
  return node.kind === 'concept' ? (node.concept_kind ?? 'concept') : node.kind;
}

export function indexAtlas(atlas: Atlas): AtlasIndex {
  const byId = new Map(atlas.nodes.map((n) => [n.id, n]));
  const lines = new Map<string, AtlasEdge[]>();
  const books = new Map<string, Set<string>>();
  const own = (n: AtlasNode) => (n.kind !== 'concept' && n.document ? [n.document.id] : []);
  for (const n of atlas.nodes) books.set(n.id, new Set(own(n)));
  for (const e of atlas.edges) {
    if (!byId.has(e.src) || !byId.has(e.dst)) continue;
    lines.set(e.src, [...(lines.get(e.src) ?? []), e]);
    lines.set(e.dst, [...(lines.get(e.dst) ?? []), e]);
    const [a, b] = [byId.get(e.src), byId.get(e.dst)];
    for (const [concept, other] of [
      [a, b],
      [b, a],
    ] as const) {
      if (concept?.kind === 'concept' && other?.kind === 'chapter' && other.document) books.get(concept.id)?.add(other.document.id);
    }
  }
  const shelf = atlas.nodes.filter((n) => n.kind === 'document');
  return { atlas, byId, lines, books, shelf };
}

function matchesQuery(node: AtlasNode, q: string): boolean {
  return node.label.toLowerCase().includes(q) || (node.kind === 'chapter' && (node.sublabel ?? '').toLowerCase().includes(q));
}

/** Node and line ids the lens keeps in play. */
export function inPlay(index: AtlasIndex, lens: LensFilters): { nodes: Set<string>; edges: Set<string> } {
  const filtering = lens.mode === 'lens';
  const kinds = filtering && lens.kinds ? new Set(lens.kinds) : null;
  const books = filtering && lens.books ? new Set(lens.books) : null;
  const links = filtering && lens.links ? new Set(lens.links) : null;
  const cross = filtering && lens.crossBook;

  const passes = (n: AtlasNode): boolean => {
    if (kinds && !kinds.has(kindKey(n))) return false;
    const mine = index.books.get(n.id) ?? new Set<string>();
    if (books && ![...mine].some((b) => books.has(b))) return false;
    return !(cross && n.kind === 'concept' && mine.size < 2);
  };
  const nodeOk = new Set(index.atlas.nodes.filter(passes).map((n) => n.id));
  let passing = index.atlas.edges.filter((e) => (!links || links.has(e.relation)) && nodeOk.has(e.src) && nodeOk.has(e.dst));
  let nodes = nodeOk;

  // Once the lens narrows, a node is lit by the lines that pass. A book's own `contains`
  // lines are structure: they never make a chapter relevant (unless structure is all you
  // asked for); a book is lit when one of its chapters is.
  if (links !== null || cross) {
    const onlyStructure = passing.every((e) => e.relation === 'contains');
    const touched = new Set<string>();
    for (const e of passing) {
      if (e.relation === 'contains' && !onlyStructure) continue;
      touched.add(e.src);
      touched.add(e.dst);
    }
    for (const e of passing) if (e.relation === 'contains' && touched.has(e.dst)) touched.add(e.src);
    nodes = new Set([...nodeOk].filter((id) => touched.has(id)));
    passing = passing.filter((e) => nodes.has(e.src) && nodes.has(e.dst));
  }

  // A search lights the names that match and whatever a passing line joins them to.
  const q = lens.query.trim().toLowerCase();
  if (q) {
    const hits = new Set(
      [...nodes].filter((id) => {
        const n = index.byId.get(id);
        return n !== undefined && matchesQuery(n, q);
      }),
    );
    passing = passing.filter((e) => hits.has(e.src) || hits.has(e.dst));
    nodes = new Set([...hits, ...passing.flatMap((e) => [e.src, e.dst])]);
  }
  return { nodes, edges: new Set(passing.map((e) => e.id)) };
}

function weightOf(n: AtlasNode): number {
  // Label priority: books first, then the best-connected concepts, then chapters.
  if (n.kind === 'document') return 10;
  return Math.log2(1 + n.degree) * (n.kind === 'concept' ? 1 : 0.6);
}

function caption(n: AtlasNode): string {
  return shorten(n.label, n.kind === 'document' ? 34 : n.kind === 'chapter' ? 28 : 30);
}

export function buildAtlasModel(index: AtlasIndex, lens: LensFilters): AtlasView {
  const play = inPlay(index, lens);
  const hide = lens.mode === 'lens' && lens.others === 'hide';
  const nodes = hide ? index.atlas.nodes.filter((n) => play.nodes.has(n.id)) : index.atlas.nodes;
  const kept = new Set(nodes.map((n) => n.id));
  const edges = index.atlas.edges.filter((e) => kept.has(e.src) && kept.has(e.dst) && (!hide || play.edges.has(e.id)));

  const lane = lanes(edges.map((e) => ({ source: e.src, target: e.dst })));
  const degree = new Map<string, number>();
  const modelEdges: ModelEdge<AtlasEdge>[] = edges.map((e, i) => {
    degree.set(e.src, (degree.get(e.src) ?? 0) + 1);
    degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1);
    return {
      id: e.id,
      source: e.src,
      target: e.dst,
      relation: e.relation,
      status: e.status,
      // A book's own chapters are structure, not evidence: drawn thin, whatever the count.
      strength: e.relation === 'contains' ? 0.5 : edgeStrength(e),
      lane: lane[i] ?? 0,
      data: e,
    };
  });
  const modelNodes: ModelNode<AtlasNode>[] = nodes.map((n) => ({
    id: n.id,
    kind: DRAWN_AS[n.kind],
    label: n.label,
    caption: caption(n),
    depth: 1,
    weight: weightOf(n),
    more: 0,
    degree: degree.get(n.id) ?? 0,
    data: n,
  }));
  const everything = play.nodes.size === index.atlas.nodes.length && play.edges.size === index.atlas.edges.length;
  return {
    model: {
      focus: '',
      nodes: modelNodes,
      edges: modelEdges,
      hidden: 0,
      truncated: index.atlas.truncated,
      strongest: Math.max(0, ...modelEdges.filter((e) => e.relation !== 'contains').map((e) => e.strength)),
    },
    lens: hide || everything ? null : play,
    shown: { nodes: play.nodes.size, edges: play.edges.size },
    total: { nodes: index.atlas.nodes.length, edges: index.atlas.edges.length },
  };
}

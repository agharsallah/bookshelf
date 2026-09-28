/**
 * From `GET /graph/neighborhood` to what the canvas draws (§11 navigation rules):
 * the focus first, then nodes by ring and score, cut at a visible budget (never more
 * than 150); edges ranked by weight × evidence, kept only between visible nodes; and
 * each node's `more` grows by the neighbours this client-side cut left out.
 */
import { anchorLabel } from '../../lib/anchors';
import type { ConceptKind, EdgeStatus, EntityKind, GraphEdge, GraphNode, Neighborhood } from '../../lib/api/types/graph';
import { conceptKindOf, type LinkKind } from './styles';

export const NODE_CAP = 150;
export const INITIAL_BUDGET = 60;
export const BUDGET_STEP = 45;

/**
 * What the canvas draws. `data` is the wire record behind it: a neighbourhood node here,
 * an atlas node on the map (`../atlas/model`); the canvas itself never reads it.
 */
export interface ModelNode<D = GraphNode> {
  id: string;
  /** Drawn shape and colour. */
  kind: EntityKind;
  /** A concept's own kind: a paper's method, dataset, metric or task gets its colour and glyph. */
  conceptKind?: ConceptKind | undefined;
  label: string;
  /** The short text drawn beside the mark, when it is not the label (a passage's place). */
  caption?: string;
  depth: number;
  weight: number;
  /** Neighbours not shown: the server's count plus this view's cut. */
  more: number;
  /** Visible edges touching this node. */
  degree: number;
  data: D;
}

export interface ModelEdge<D = GraphEdge> {
  id: string;
  source: string;
  target: string;
  relation: LinkKind;
  status: EdgeStatus;
  /** weight × max(evidence, 1): the ranking score. */
  strength: number;
  /** Position among the edges joining the same pair, centred on 0, for curve offsets. */
  lane: number;
  data: D;
}

export interface GraphModel<N = GraphNode, E = GraphEdge> {
  /** The pinned centre; empty when there is none (the map). */
  focus: string;
  nodes: ModelNode<N>[];
  edges: ModelEdge<E>[];
  /** Nodes the budget held back ("show more"). */
  hidden: number;
  /** The server's cap cut the neighbourhood too. */
  truncated: boolean;
  strongest: number;
}

export function edgeStrength(edge: Pick<GraphEdge, 'weight' | 'evidence_count'>): number {
  return edge.weight * Math.max(edge.evidence_count, 1);
}

function rank(focus: string) {
  return (a: GraphNode, b: GraphNode) =>
    Number(b.id === focus) - Number(a.id === focus) ||
    a.depth - b.depth ||
    b.weight - a.weight ||
    a.label.localeCompare(b.label);
}

export function buildModel(hood: Neighborhood, budget = INITIAL_BUDGET): GraphModel {
  const limit = Math.max(1, Math.min(NODE_CAP, budget));
  const ranked = [...new Map(hood.nodes.map((n) => [n.id, n])).values()].sort(rank(hood.focus));
  const kept = ranked.slice(0, limit);
  const keptIds = new Set(kept.map((n) => n.id));

  const edges = hood.edges
    .filter((e) => e.src !== e.dst && keptIds.has(e.src) && keptIds.has(e.dst))
    .map((e) => ({ edge: e, strength: edgeStrength(e) }))
    .sort((a, b) => b.strength - a.strength || a.edge.id.localeCompare(b.edge.id));

  const cutNeighbours = new Map<string, Set<string>>();
  for (const e of hood.edges) {
    const pairs: [string, string][] = [
      [e.src, e.dst],
      [e.dst, e.src],
    ];
    for (const [mine, other] of pairs) {
      if (!keptIds.has(mine) || keptIds.has(other)) continue;
      const set = cutNeighbours.get(mine) ?? new Set<string>();
      set.add(other);
      cutNeighbours.set(mine, set);
    }
  }

  const lane = lanes(edges.map(({ edge }) => ({ source: edge.src, target: edge.dst })));
  const degree = new Map<string, number>();
  const modelEdges: ModelEdge[] = edges.map(({ edge, strength }, i) => {
    degree.set(edge.src, (degree.get(edge.src) ?? 0) + 1);
    degree.set(edge.dst, (degree.get(edge.dst) ?? 0) + 1);
    return {
      id: edge.id,
      source: edge.src,
      target: edge.dst,
      relation: edge.relation,
      status: edge.status,
      strength,
      lane: lane[i] ?? 0,
      data: edge,
    };
  });

  const nodes: ModelNode[] = kept.map((n) => ({
    id: n.id,
    kind: n.kind,
    // A neighbourhood concept's sublabel is its kind (graph/evidence.py labels).
    conceptKind: n.kind === 'concept' ? conceptKindOf(n.sublabel) : undefined,
    label: n.label,
    depth: n.id === hood.focus ? 0 : Math.max(1, n.depth),
    weight: n.weight,
    caption: n.kind === 'node' && n.anchor ? anchorLabel(n.anchor) : undefined,
    more: n.more + (cutNeighbours.get(n.id)?.size ?? 0),
    degree: degree.get(n.id) ?? 0,
    data: n,
  }));

  return {
    focus: hood.focus,
    nodes,
    edges: modelEdges,
    hidden: ranked.length - kept.length,
    truncated: hood.truncated,
    strongest: modelEdges[0]?.strength ?? 0,
  };
}

/** The next budget after "show more", never past the cap. */
export function nextBudget(budget: number, available: number): number {
  return Math.min(NODE_CAP, available, budget + BUDGET_STEP);
}

/** Where each edge sits among those joining the same pair, centred on 0 (curve offsets). */
export function lanes(edges: readonly { source: string; target: string }[]): number[] {
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const total = new Map<string, number>();
  for (const e of edges) total.set(key(e.source, e.target), (total.get(key(e.source, e.target)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return edges.map((e) => {
    const k = key(e.source, e.target);
    const index = seen.get(k) ?? 0;
    seen.set(k, index + 1);
    return index - ((total.get(k) ?? 1) - 1) / 2;
  });
}

/** Neighbour ids of a node over visible edges (hover highlighting). */
export function neighbours(model: Pick<GraphModel<unknown, unknown>, 'edges'>, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of model.edges) {
    if (e.source === id) out.add(e.target);
    if (e.target === id) out.add(e.source);
  }
  return out;
}

/** Small neighbourhood builders for graph tests. */
import type { GraphEdge, GraphNode, Neighborhood } from '../../lib/api/types/graph';

export function gnode(id: string, depth: number, extra: Partial<GraphNode> = {}): GraphNode {
  const kind = id.startsWith('node:') ? 'node' : id.startsWith('document:') ? 'document' : id.startsWith('artifact:') ? 'artifact' : 'concept';
  return { id, kind, label: id.split(':')[1] ?? id, depth, weight: 1, more: 0, ...extra };
}

let edgeSeq = 0;
export function gedge(src: string, dst: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  edgeSeq += 1;
  const id = extra.id ?? `e${edgeSeq}`;
  return { id, src, dst, relation: 'supports', weight: 1, evidence_count: 1, status: 'accepted', origin: 'skill', edge_ids: [id], ...extra };
}

export function hood(nodes: GraphNode[], edges: GraphEdge[], focus = nodes[0]?.id ?? ''): Neighborhood {
  return { focus, depth: 2, nodes, edges, truncated: false };
}

/** A focus with `ring1` neighbours, each with `ring2` children of their own. */
export function star(ring1: number, ring2 = 0): Neighborhood {
  const focus = gnode('concept:focus', 0);
  const nodes: GraphNode[] = [focus];
  const edges: GraphEdge[] = [];
  for (let i = 0; i < ring1; i += 1) {
    const a = gnode(`concept:a${i}`, 1, { weight: 1 - i / (ring1 + 1) });
    nodes.push(a);
    edges.push(gedge(focus.id, a.id, { id: `f-a${i}`, weight: a.weight }));
    for (let j = 0; j < ring2; j += 1) {
      const b = gnode(`node:doc#ch0${i}/p00${j}`, 2, { weight: 0.5 });
      nodes.push(b);
      edges.push(gedge(a.id, b.id, { id: `a${i}-b${j}`, relation: 'mentions', weight: 0.5 }));
    }
  }
  return hood(nodes, edges, focus.id);
}

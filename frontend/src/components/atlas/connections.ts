/**
 * What the detail panel says about a node, read from the whole atlas (never the lens:
 * a filter narrows the picture, not what you can learn about the thing you picked).
 *
 * - a concept: the chapters it appears in (by book, in reading order) and its related ideas;
 * - a chapter: the ideas it discusses and the chapters that share them, strongest first;
 * - a book: its chapters and the ideas it leans on most.
 */
import type { AtlasEdge, AtlasNode, AtlasRelation } from '../../lib/api/types/graph';
import type { AtlasIndex } from './model';

export interface Link {
  node: AtlasNode;
  relation: AtlasRelation;
  /** This node is the line's source. */
  outgoing: boolean;
  edge: AtlasEdge;
}

export interface Shared {
  chapter: AtlasNode;
  /** The concepts both chapters name. */
  concepts: AtlasNode[];
  edge: AtlasEdge;
}

function links(index: AtlasIndex, id: string, keep: (other: AtlasNode, edge: AtlasEdge) => boolean): Link[] {
  const out: Link[] = [];
  for (const edge of index.lines.get(id) ?? []) {
    const otherId = edge.src === id ? edge.dst : edge.src;
    const node = index.byId.get(otherId);
    if (node && keep(node, edge))
      out.push({
        node,
        relation: edge.relation,
        outgoing: edge.src === id,
        edge,
      });
  }
  return out;
}

const strength = (l: Link) => l.edge.weight * Math.max(l.edge.evidence_count, 1);
const byStrength = (a: Link, b: Link) => strength(b) - strength(a) || a.node.label.localeCompare(b.node.label);

function inReadingOrder(index: AtlasIndex) {
  const shelf = new Map(index.shelf.map((b, i) => [b.document?.id ?? b.id, i]));
  return (a: Link, b: Link) =>
    (shelf.get(a.node.document?.id ?? '') ?? 0) - (shelf.get(b.node.document?.id ?? '') ?? 0) || a.node.ordinal - b.node.ordinal;
}

/** One chapter a concept appears in, with every way it links there. */
export interface Appearance extends Link {
  relations: AtlasRelation[];
  /** Evidence passages over all those links. */
  passages: number;
}

/** The chapters that link to a concept, once each, book by book in reading order. */
export function appearances(index: AtlasIndex, conceptId: string): Appearance[] {
  const byChapter = new Map<string, Appearance>();
  for (const l of links(index, conceptId, (n) => n.kind === 'chapter').sort(byStrength)) {
    const seen = byChapter.get(l.node.id);
    if (seen) {
      seen.relations.push(l.relation);
      seen.passages += l.edge.evidence_count;
    } else byChapter.set(l.node.id, { ...l, relations: [l.relation], passages: l.edge.evidence_count });
  }
  return [...byChapter.values()].sort(inReadingOrder(index));
}

/** Concepts joined to this node by a typed relation. */
export function relatedIdeas(index: AtlasIndex, id: string): Link[] {
  return links(index, id, (n, e) => n.kind === 'concept' && e.relation !== 'shares').sort(byStrength);
}

/** A book's chapters in reading order. */
export function chaptersOf(index: AtlasIndex, bookId: string): Link[] {
  return links(index, bookId, (n, e) => e.relation === 'contains' && n.kind === 'chapter').sort(inReadingOrder(index));
}

/** The chapters that share ideas with this one, strongest first, with what they share. */
export function sharedWith(index: AtlasIndex, chapterId: string): Shared[] {
  return links(index, chapterId, (n, e) => e.relation === 'shares' && n.kind === 'chapter')
    .sort(byStrength)
    .map((l) => ({
      chapter: l.node,
      concepts: l.edge.concepts.map((c) => index.byId.get(c)).filter((c): c is AtlasNode => c !== undefined),
      edge: l.edge,
    }));
}

/** The ideas a book leans on most, over all its chapters. */
export function bookIdeas(index: AtlasIndex, bookId: string, limit = 8): AtlasNode[] {
  const score = new Map<string, number>();
  for (const chapter of chaptersOf(index, bookId)) {
    for (const idea of relatedIdeas(index, chapter.node.id)) score.set(idea.node.id, (score.get(idea.node.id) ?? 0) + strength(idea));
  }
  return [...score]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => index.byId.get(id))
    .filter((n): n is AtlasNode => n !== undefined);
}

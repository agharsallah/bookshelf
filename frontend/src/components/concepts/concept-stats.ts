/**
 * Small numbers the concept surfaces draw: how connected a concept is relative to the
 * others in view (the index's link meter), and how much each book contributes to a
 * concept (the concept page's "Across your books" bars). Pure, so it is tested alone.
 */
import type { ConceptDetail, ConceptKind, ConceptSummary, GraphDocument } from '../../lib/api/types/graph';

export const KIND_NAMES: Record<ConceptKind, string> = {
  concept: 'Concept',
  framework: 'Framework',
  person: 'Person',
  work: 'Work',
  term: 'Term',
  method: 'Method',
  dataset: 'Dataset',
  metric: 'Metric',
  task: 'Task',
};

/** The most links any concept in `items` has (0 when none are counted). */
export function strongestOf(items: readonly Pick<ConceptSummary, 'edge_count'>[]): number {
  return items.reduce((max, c) => Math.max(max, c.edge_count ?? 0), 0);
}

/**
 * How full a concept's meter is, 0–1, relative to the strongest in view. A concept
 * with any link always shows a sliver, so "one link" never reads as "none".
 */
export function connectionShare(count: number | undefined, strongest: number): number {
  if (!count || count <= 0 || strongest <= 0) return 0;
  return Math.max(0.08, Math.min(1, count / strongest));
}

export interface BookEvidence {
  document: GraphDocument;
  /** Distinct passages from this book that ground the concept or one of its links. */
  passages: number;
  /** Links to this concept whose evidence cites this book. */
  connections: number;
}

/** Each book behind a concept, most passages first (ties by title). */
export function evidenceByBook(detail: Pick<ConceptDetail, 'blurb_passages' | 'relations'>): BookEvidence[] {
  const books = new Map<string, { document: GraphDocument; refs: Set<string>; edges: Set<string> }>();
  const entry = (document: GraphDocument) => {
    let book = books.get(document.id);
    if (!book) {
      book = { document, refs: new Set(), edges: new Set() };
      books.set(document.id, book);
    }
    return book;
  };
  for (const p of detail.blurb_passages) if (p.document) entry(p.document).refs.add(p.ref);
  for (const group of detail.relations) {
    for (const edge of group.edges) {
      for (const p of edge.evidence) {
        if (!p.document) continue;
        const book = entry(p.document);
        book.refs.add(p.ref);
        book.edges.add(edge.id);
      }
    }
  }
  return [...books.values()]
    .map((b) => ({ document: b.document, passages: b.refs.size, connections: b.edges.size }))
    .sort((a, b) => b.passages - a.passages || a.document.title.localeCompare(b.document.title));
}

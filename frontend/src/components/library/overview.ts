/**
 * The overview above the shelf: what is on it in a sentence ("3 books and 2 papers"),
 * and the totals worth a glance: chapters read, study material ready, drafts waiting
 * for review (workshop mode) and notes taken.
 */
import type { DocumentSummary } from '../../lib/api/types/documents';
import type { FacetSegment } from './facets';
import type { ShelfReading } from './progress';

export interface ShelfTotals {
  chapters: number;
  /** Chapters read, a partly read one counting its share. */
  chaptersRead: number;
  ready: number;
  drafts: number;
  notes: number;
}

interface Counted { doc: Pick<DocumentSummary, 'counts' | 'artifacts'>; reading: Pick<ShelfReading, 'share'> }

export function shelfTotals(items: readonly Counted[]): ShelfTotals {
  const totals: ShelfTotals = { chapters: 0, chaptersRead: 0, ready: 0, drafts: 0, notes: 0 };
  for (const { doc, reading } of items) {
    totals.chapters += doc.counts.chapters;
    totals.chaptersRead += reading.share * doc.counts.chapters;
    totals.ready += doc.artifacts.approved;
    totals.drafts += doc.artifacts.draft + doc.artifacts.needs_review;
    totals.notes += doc.counts.notes;
  }
  totals.chaptersRead = Math.round(totals.chaptersRead);
  return totals;
}

const NOUNS: Record<string, [string, string]> = {
  book: ['book', 'books'],
  paper: ['paper', 'papers'],
  article: ['article', 'articles'],
};

/** "3 books and 2 papers", "1 article": the kinds on the shelf, empty ones left out. */
export function shelfSentence(kinds: readonly Pick<FacetSegment, 'value' | 'count'>[]): string {
  const parts = kinds
    .filter((k) => k.count > 0)
    .map((k) => {
      const [one, many] = NOUNS[k.value] ?? [k.value, `${k.value}s`];
      return `${k.count} ${k.count === 1 ? one : many}`;
    });
  if (parts.length <= 1) return parts[0] ?? 'Nothing';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

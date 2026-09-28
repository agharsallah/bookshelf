/**
 * The references tab: what each bibliography entry is to you (on the shelf, a reading
 * candidate, or neither), and the tab's URL filters (`intent`, `shelf=1`).
 */
import { CITATION_INTENTS, type CitationIntent, type PaperReferenceRow } from '../../lib/api/types/papers';
import { paperHref } from './tabs';

export type ReferenceStanding =
  | { kind: 'shelf'; href: string; title: string }
  | { kind: 'candidate'; id: string; status: NonNullable<PaperReferenceRow['candidate']>['status'] }
  | { kind: 'none' };

export function referenceStanding(row: Pick<PaperReferenceRow, 'target' | 'candidate'>): ReferenceStanding {
  if (row.target) return { kind: 'shelf', href: `/documents/${encodeURIComponent(row.target.slug)}`, title: row.target.title };
  if (row.candidate) return { kind: 'candidate', id: row.candidate.id, status: row.candidate.status };
  return { kind: 'none' };
}

/** The entry's title, else its raw text (a parse that found no title). */
export function referenceTitle(row: Pick<PaperReferenceRow, 'title' | 'raw'>): string {
  return row.title?.trim() || row.raw;
}

export interface ReferenceFilters {
  intent: CitationIntent | null;
  onShelf: boolean;
}

export function parseReferenceFilters(params: URLSearchParams): ReferenceFilters {
  const intent = params.get('intent');
  return {
    intent: (CITATION_INTENTS as readonly (string | null)[]).includes(intent) ? (intent as CitationIntent) : null,
    onShelf: params.get('shelf') === '1',
  };
}

/** The `GET /papers/{ref}/references` query. */
export function referencesQuery(filters: ReferenceFilters): { intent?: CitationIntent; on_shelf?: boolean } {
  return { ...(filters.intent ? { intent: filters.intent } : {}), ...(filters.onShelf ? { on_shelf: true } : {}) };
}

export function referencesHref(slug: string, filters: ReferenceFilters): string {
  return paperHref(slug, 'references', {
    ...(filters.intent ? { intent: filters.intent } : {}),
    ...(filters.onShelf ? { shelf: '1' } : {}),
  });
}

/** Intents present in the bibliography, with counts, in the vocabulary's order. */
export function intentCounts(rows: readonly Pick<PaperReferenceRow, 'intent'>[]): { intent: CitationIntent; count: number }[] {
  return CITATION_INTENTS.map((intent) => ({ intent, count: rows.filter((r) => r.intent === intent).length })).filter((c) => c.count > 0);
}

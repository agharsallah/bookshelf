/**
 * Library filters live in the URL (`/library?tag=systems&status=parsed&author=&q=`),
 * so the shelf is server-rendered, linkable and works without JavaScript. With
 * JavaScript the same matching runs in the browser as the reader types, and the URL
 * is kept in step (history.replaceState) so the view stays shareable.
 */
import type { Query } from '../../lib/api/client';
import { DOCUMENT_STATUSES, type DocumentStatus } from '../../lib/api/types/documents';
import { pipelineProgress } from '../../lib/documents/pipeline';
import { DEFAULT_SORT, type Sort } from './sort';

export interface LibraryFilters {
  tag: string | null;
  status: DocumentStatus | null;
  author: string | null;
  q: string | null;
}

export const FILTER_KEYS = ['tag', 'status', 'author', 'q'] as const satisfies readonly (keyof LibraryFilters)[];

const MAX = { tag: 64, author: 200, q: 200 } as const;

function clean(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, max) : null;
}

function isStatus(value: string | null): value is DocumentStatus {
  return value !== null && (DOCUMENT_STATUSES as readonly string[]).includes(value);
}

/** Read filters from a URL's search params; unknown statuses and blanks are dropped. */
export function parseFilters(params: URLSearchParams): LibraryFilters {
  const status = params.get('status');
  return {
    tag: clean(params.get('tag'), MAX.tag),
    status: isStatus(status) ? status : null,
    author: clean(params.get('author'), MAX.author),
    q: clean(params.get('q'), MAX.q),
  };
}

/** The `GET /documents` query for these filters (unset filters are omitted). */
export function documentsQuery(filters: LibraryFilters, limit = 100): Query {
  const query: Query = { limit };
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value !== null) query[key] = value;
  }
  return query;
}

/** A `/library` link with one filter changed (`null` clears it), the others kept. */
export function filterHref(
  filters: LibraryFilters,
  change: Partial<LibraryFilters>,
  base = '/library',
): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = next[key];
    if (value !== null) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function hasFilters(filters: LibraryFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== null);
}

/** Every tag on the shelf with its count, most used first, then alphabetical. */
export function tagCloud(documents: readonly { tags: readonly string[] }[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const doc of documents) for (const tag of doc.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** What a filter looks at in a book (a DocumentSummary, or a shelf item's data attributes). */
export interface Filterable {
  title: string;
  authors: readonly string[];
  tags: readonly string[];
  status: string;
}

const folded = (text: string) => text.toLocaleLowerCase();

/**
 * Whether a book passes the filters, as the API decides: the tag exactly, the state
 * exactly, and case-insensitive substrings of the title and of the authors.
 */
export function matchesFilters(book: Filterable, filters: LibraryFilters): boolean {
  if (filters.tag !== null && !book.tags.includes(filters.tag)) return false;
  if (filters.status !== null && book.status !== filters.status) return false;
  if (filters.author !== null && !folded(book.authors.join(' ')).includes(folded(filters.author))) return false;
  if (filters.q !== null && !folded(book.title).includes(folded(filters.q))) return false;
  return true;
}

/** The library URL for filters and an order; the default order is left out. */
export function libraryHref(filters: LibraryFilters, sort: Sort, base = '/library'): string {
  const href = filterHref(filters, {}, base);
  if (sort === DEFAULT_SORT) return href;
  return `${href}${href.includes('?') ? '&' : '?'}sort=${sort}`;
}

/** "No books match “loops” by “Meadows”." for an empty result. */
export function noMatchMessage(filters: LibraryFilters): string {
  const parts = [
    filters.q !== null ? `match “${filters.q}”` : null,
    filters.author !== null ? `by “${filters.author}”` : null,
    filters.tag !== null ? `tagged “${filters.tag}”` : null,
    filters.status !== null ? `in the state “${pipelineProgress(filters.status).label}”` : null,
  ].filter(Boolean);
  return parts.length ? `No books ${parts.join(' ')}.` : 'No books on the shelf yet.';
}

/** The line above the books: "2 books", or "1 of 2 books" while filtering. */
export function resultSummary(shown: number, total: number, filtered: boolean): string {
  const books = `${total} ${total === 1 ? 'book' : 'books'}`;
  return filtered ? `${shown} of ${books}` : books;
}

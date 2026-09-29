/**
 * Library filters live in the URL (`/library?q=flow&genre=paper&reading=finished&tag=systems`),
 * so the shelf is server-rendered, linkable and works without JavaScript. With
 * JavaScript the same matching runs in the browser as the reader types, and the URL
 * is kept in step (history.replaceState) so the view stays shareable. `genre`,
 * `reading`, `study` and `theme` are the overview's facets (`facets.ts`); `status` is
 * the workshop's pipeline state; `author` is kept for links that name one; `collection`
 * is a hand-gathered collection's slug (`/collections`).
 */
import { DOCUMENT_STATUSES, GENRE_LABELS, GENRES, type DocumentStatus, type Genre } from '../../lib/api/types/documents';
import { pipelineProgress } from '../../lib/documents/pipeline';
import { bucketOf, FIXED_PALETTE, NO_THEME, NO_THEME_LABEL, READING_BUCKETS, STUDY_BUCKETS, type ReadingBucket, type StudyBucket } from './facets';
import { DEFAULT_SORT, type Sort } from './sort';

export interface LibraryFilters {
  tag: string | null;
  status: DocumentStatus | null;
  /** Book, paper or article (`documents.genre`). */
  genre: Genre | null;
  reading: ReadingBucket | null;
  study: StudyBucket | null;
  /** A theme's name, or `none` for books without a library card yet. */
  theme: string | null;
  author: string | null;
  /** Words in the title or the authors. */
  q: string | null;
  /** A collection's slug: only its members. */
  collection: string | null;
}

export const FILTER_KEYS = ['q', 'genre', 'reading', 'study', 'theme', 'tag', 'status', 'author', 'collection'] as const satisfies readonly (keyof LibraryFilters)[];
export type FilterKey = (typeof FILTER_KEYS)[number];

export const NO_FILTERS: LibraryFilters = {
  tag: null,
  status: null,
  genre: null,
  reading: null,
  study: null,
  theme: null,
  author: null,
  q: null,
  collection: null,
};

const MAX = { tag: 64, theme: 48, author: 200, q: 200, collection: 80 } as const;

function clean(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, max) : null;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | null): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** Read filters from a URL's search params; unknown values and blanks are dropped. */
export function parseFilters(params: URLSearchParams): LibraryFilters {
  return {
    tag: clean(params.get('tag'), MAX.tag),
    status: oneOf(DOCUMENT_STATUSES, params.get('status')),
    genre: oneOf(GENRES, params.get('genre')),
    reading: oneOf(READING_BUCKETS, params.get('reading')),
    study: oneOf(STUDY_BUCKETS, params.get('study')),
    theme: clean(params.get('theme'), MAX.theme),
    author: clean(params.get('author'), MAX.author),
    q: clean(params.get('q'), MAX.q),
    collection: clean(params.get('collection'), MAX.collection),
  };
}

/** A `/library` link with one filter changed (`null` clears it), the others kept. */
export function filterHref(filters: LibraryFilters, change: Partial<LibraryFilters>, base = '/library'): string {
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

/** What a filter looks at in a book (its facet buckets included), or a shelf item's data attributes. */
export interface Filterable {
  title: string;
  authors: readonly string[];
  tags: readonly string[];
  status: string;
  genre: string;
  reading: string;
  study: string;
  theme: string;
  /** Slugs of the collections holding it. */
  collections: readonly string[];
}

const folded = (text: string) => text.toLocaleLowerCase();

/**
 * Whether a book passes the filters: the facets, tag and state exactly, and
 * case-insensitive substrings of the title or authors (`q`) and of the authors (`author`).
 */
export function matchesFilters(book: Filterable, filters: LibraryFilters): boolean {
  if (filters.tag !== null && !book.tags.includes(filters.tag)) return false;
  if (filters.status !== null && book.status !== filters.status) return false;
  if (filters.genre !== null && book.genre !== filters.genre) return false;
  if (filters.reading !== null && book.reading !== filters.reading) return false;
  if (filters.study !== null && book.study !== filters.study) return false;
  if (filters.theme !== null && book.theme !== filters.theme) return false;
  if (filters.collection !== null && !book.collections.includes(filters.collection)) return false;
  const authors = folded(book.authors.join(' '));
  if (filters.author !== null && !authors.includes(folded(filters.author))) return false;
  if (filters.q !== null) {
    const words = folded(filters.q);
    if (!folded(book.title).includes(words) && !authors.includes(words)) return false;
  }
  return true;
}

/** The library URL for filters and an order; the default order is left out. */
export function libraryHref(filters: LibraryFilters, sort: Sort, base = '/library'): string {
  const href = filterHref(filters, {}, base);
  if (sort === DEFAULT_SORT) return href;
  return `${href}${href.includes('?') ? '&' : '?'}sort=${sort}`;
}

export interface ActiveFilter {
  key: FilterKey;
  /** The chip's words: "Papers", "Not started", "“flow”", "career". */
  label: string;
  /** What removing it does, for screen readers. */
  remove: string;
}

/** A collection's name by slug, for chips and messages; an unknown slug shows as itself. */
export type CollectionNames = Readonly<Record<string, string>>;

/** The filters that are set, as removable chips, in the order they are written to the URL. */
export function activeFilters(filters: LibraryFilters, names: CollectionNames = {}): ActiveFilter[] {
  const label = (key: FilterKey, value: string): string => {
    if (key === 'q') return `“${value}”`;
    if (key === 'author') return `by ${value}`;
    if (key === 'genre') return bucketOf(FIXED_PALETTE, 'kind', value).label;
    if (key === 'reading') return bucketOf(FIXED_PALETTE, 'reading', value).label;
    if (key === 'study') return bucketOf(FIXED_PALETTE, 'study', value).label;
    if (key === 'theme') return value === NO_THEME ? NO_THEME_LABEL : value;
    if (key === 'status') return pipelineProgress(value as DocumentStatus).label;
    if (key === 'collection') return `in ${names[value] ?? value}`;
    return value;
  };
  return FILTER_KEYS.flatMap((key) => {
    const value = filters[key];
    if (value === null) return [];
    const text = label(key, value);
    return [{ key, label: text, remove: `Remove the filter ${text}` }];
  });
}

const READING_PHRASES: Record<ReadingBucket, string> = {
  reading: 'you are reading',
  finished: 'you have finished',
  unread: 'you have not started',
};
const STUDY_PHRASES: Record<StudyBucket, string> = {
  ready: 'with study material ready',
  drafts: 'with only drafts to study',
  none: 'without study material',
};

/** "No papers match “bert” you have finished." for an empty result; a genre names its own kind. */
export function noMatchMessage(filters: LibraryFilters, names: CollectionNames = {}): string {
  const noun = filters.genre !== null ? `${GENRE_LABELS[filters.genre].toLowerCase()}s` : 'books';
  const parts = [
    filters.q !== null ? `match “${filters.q}”` : null,
    filters.author !== null ? `by “${filters.author}”` : null,
    filters.reading !== null ? READING_PHRASES[filters.reading] : null,
    filters.study !== null ? STUDY_PHRASES[filters.study] : null,
    filters.theme === NO_THEME ? 'without a theme yet' : filters.theme !== null ? `under “${filters.theme}”` : null,
    filters.tag !== null ? `tagged “${filters.tag}”` : null,
    filters.status !== null ? `in the state “${pipelineProgress(filters.status).label}”` : null,
    filters.collection !== null ? `in “${names[filters.collection] ?? filters.collection}”` : null,
  ].filter(Boolean);
  if (parts.length) return `No ${noun} ${parts.join(' ')}.`;
  return filters.genre !== null ? `No ${noun} on the shelf yet.` : 'No books on the shelf yet.';
}

/** The line above the books: "2 books", or "1 of 2 books" while filtering. */
export function resultSummary(shown: number, total: number, filtered: boolean): string {
  const books = `${total} ${total === 1 ? 'book' : 'books'}`;
  return filtered ? `${shown} of ${books}` : books;
}

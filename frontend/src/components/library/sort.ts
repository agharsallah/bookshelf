/**
 * The shelf's order. It lives in the URL (`?sort=title`; the default, recently read,
 * is left out) and is applied twice with the same comparison: on the server for the
 * first paint, and in the browser when the reader picks another order. Each order
 * runs the way a reader would expect it (newest, longest, most read first); ties
 * fall back to the newest added, so a book keeps a stable place.
 */
import { pagesOf, spineAuthor } from './spine';

export const SORTS = [
  { value: 'read', label: 'Recently read' },
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title, A to Z' },
  { value: 'author', label: 'Author, A to Z' },
  { value: 'progress', label: 'Most read' },
  { value: 'length', label: 'Longest' },
  { value: 'year', label: 'Newest published' },
  { value: 'study', label: 'Most study material' },
] as const;
export type Sort = (typeof SORTS)[number]['value'];

export const DEFAULT_SORT: Sort = 'read';

export function parseSort(value: string | null | undefined): Sort {
  return SORTS.some((s) => s.value === value) ? (value as Sort) : DEFAULT_SORT;
}

/** What the call-number sticker on each spine shows under an order: the value it sorts by. */
export type Sticker = 'year' | 'progress' | 'length';

export function stickerFor(sort: Sort): Sticker {
  return sort === 'progress' || sort === 'length' ? sort : 'year';
}

/** What a book is sorted by; also written to its `data-*` attributes for the browser. */
export interface SortKeys {
  title: string;
  author: string;
  /** ISO timestamps; `read` is empty when the book was never opened. */
  added: string;
  read: string;
  /** 0–1 of the book read; -1 when never opened, so a book barely started still ranks above it. */
  progress: number;
  /** Pages, printed or estimated; 0 when unknown. */
  length: number;
  /** Year published; 0 when unknown. */
  year: number;
  /** Approved study material. */
  study: number;
}

const ARTICLE = /^(the|a|an)\s+/i;

/** "The Goal" files under G, as in a library catalogue. */
export function titleKey(title: string): string {
  return title.trim().replace(ARTICLE, '').toLocaleLowerCase();
}

/** The first author's surname, lower-cased; empty when there is no author. */
export function authorKey(authors: readonly string[]): string {
  return spineAuthor(authors.slice(0, 1)).toLocaleLowerCase();
}

export interface SortableDoc {
  title: string;
  authors: readonly string[];
  created_at: string;
  year: number | null;
  page_count: number | null;
  counts: { blocks: number };
  artifacts: { approved: number };
}

export function sortKeys(doc: SortableDoc, reading: { share: number; lastRead: string | null }): SortKeys {
  return {
    title: titleKey(doc.title),
    author: authorKey(doc.authors),
    added: doc.created_at,
    read: reading.lastRead ?? '',
    progress: reading.lastRead ? reading.share : -1,
    length: pagesOf(doc).pages ?? 0,
    year: doc.year ?? 0,
    study: doc.artifacts.approved,
  };
}

const newest = (a: string, b: string) => b.localeCompare(a);
const alpha = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
/** Blanks (no author) go last in an alphabetical order. */
const alphaBlanksLast = (a: string, b: string) => (a && b ? alpha(a, b) : a ? -1 : b ? 1 : 0);
const most = (a: number, b: number) => b - a;

/** Compare two books for an order. Ties fall back to the newest added. */
export function compareBooks(sort: Sort): (a: SortKeys, b: SortKeys) => number {
  return (a, b) => {
    let order = 0;
    if (sort === 'read') order = newest(a.read, b.read);
    else if (sort === 'title') order = alpha(a.title, b.title);
    else if (sort === 'author') order = alphaBlanksLast(a.author, b.author) || alpha(a.title, b.title);
    else if (sort === 'progress') order = most(a.progress, b.progress);
    else if (sort === 'length') order = most(a.length, b.length);
    else if (sort === 'year') order = most(a.year, b.year);
    else if (sort === 'study') order = most(a.study, b.study);
    return order || newest(a.added, b.added);
  };
}

export function sortBy<T>(items: readonly T[], keysOf: (item: T) => SortKeys, sort: Sort): T[] {
  const compare = compareBooks(sort);
  return [...items].sort((a, b) => compare(keysOf(a), keysOf(b)));
}

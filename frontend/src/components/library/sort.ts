/**
 * The shelf's order. It lives in the URL (`?sort=title`; the default, recently read,
 * is left out) and is applied twice with the same comparison: on the server for the
 * first paint, and in the browser when the reader picks another order.
 */
import { spineAuthor } from './spine';

export const SORTS = [
  { value: 'read', label: 'Recently read' },
  { value: 'added', label: 'Recently added' },
  { value: 'title', label: 'Title' },
  { value: 'author', label: 'Author' },
] as const;
export type Sort = (typeof SORTS)[number]['value'];

export const DEFAULT_SORT: Sort = 'read';

export function parseSort(value: string | null | undefined): Sort {
  return SORTS.some((s) => s.value === value) ? (value as Sort) : DEFAULT_SORT;
}

/** What a book is sorted by; also written to its `data-*` attributes for the browser. */
export interface SortKeys {
  title: string;
  author: string;
  /** ISO timestamps; `read` is empty when the book was never opened. */
  added: string;
  read: string;
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

export function sortKeys(
  doc: { title: string; authors: readonly string[]; created_at: string },
  lastRead: string | null,
): SortKeys {
  return { title: titleKey(doc.title), author: authorKey(doc.authors), added: doc.created_at, read: lastRead ?? '' };
}

const newest = (a: string, b: string) => b.localeCompare(a);
const alpha = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
/** Blanks (no author) go last in an alphabetical order. */
const alphaBlanksLast = (a: string, b: string) => (a && b ? alpha(a, b) : a ? -1 : b ? 1 : 0);

/**
 * Compare two books for an order. Ties fall back to the newest added, so books never
 * read keep a stable place under "recently read".
 */
export function compareBooks(sort: Sort): (a: SortKeys, b: SortKeys) => number {
  return (a, b) => {
    let order = 0;
    if (sort === 'read') order = newest(a.read, b.read);
    else if (sort === 'title') order = alpha(a.title, b.title);
    else if (sort === 'author') order = alphaBlanksLast(a.author, b.author) || alpha(a.title, b.title);
    return order || newest(a.added, b.added);
  };
}

export function sortBy<T>(items: readonly T[], keysOf: (item: T) => SortKeys, sort: Sort): T[] {
  const compare = compareBooks(sort);
  return [...items].sort((a, b) => compare(keysOf(a), keysOf(b)));
}

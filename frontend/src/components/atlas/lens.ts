/**
 * The map's view state, and its place in the URL so a lens can be bookmarked and shared.
 *
 * - **map** mode shows the whole shelf; only the search highlights.
 * - **lens** mode adds filters: which connections, which kinds of thing, which books,
 *   only ideas that cross books; what happens to the rest (dimmed or hidden); and
 *   whether the layout groups by book.
 *
 * `null` in a list means "all of them", so a new relation or kind is shown by default
 * and the URL stays short. Unknown values in a URL are dropped, never trusted.
 *
 *   /map?mode=lens&links=supports,contradicts&kinds=framework&books=<id>&cross=1
 *        &others=hide&group=book&q=loop&sel=concept:<id>
 */
import { CONCEPT_KINDS, type ConceptKind } from '../../lib/api/types/graph';
import { LINK_KINDS, type LinkKind } from '../graph/styles';

export const MODES = ['map', 'lens'] as const;
export type Mode = (typeof MODES)[number];

/** What a node is, for filtering: a book, a chapter, or a concept by its own kind. */
export const KIND_KEYS = ['document', 'chapter', ...CONCEPT_KINDS] as const;
export type KindKey = 'document' | 'chapter' | ConceptKind;

export interface LensState {
  mode: Mode;
  /** Connection types kept; null is all. */
  links: LinkKind[] | null;
  /** Kinds kept; null is all. */
  kinds: KindKey[] | null;
  /** Book ids kept; null is all. */
  books: string[] | null;
  /** Only concepts that appear in more than one book (and what links to them). */
  crossBook: boolean;
  /** What the lens does to everything it leaves out. */
  others: 'dim' | 'hide';
  /** Pull each book's chapters and concepts together. */
  group: 'free' | 'book';
  /** Highlight names containing this. */
  query: string;
  /** The selected node or line. */
  selected: string | null;
}

/** The part of the lens that decides what is in play (not the selection, not the layout). */
export type LensFilters = Pick<LensState, 'mode' | 'links' | 'kinds' | 'books' | 'crossBook' | 'others' | 'query'>;

export const DEFAULT_LENS: LensState = {
  mode: 'map',
  links: null,
  kinds: null,
  books: null,
  crossBook: false,
  others: 'dim',
  group: 'free',
  query: '',
  selected: null,
};

function list<T extends string>(raw: string | null, allowed: readonly T[]): T[] | null {
  if (raw === null) return null;
  const wanted = new Set(raw.split(',').filter(Boolean));
  return allowed.filter((value) => wanted.has(value));
}

export function lensFromParams(params: URLSearchParams): LensState {
  const books = params.get('books');
  return {
    mode: params.get('mode') === 'lens' ? 'lens' : 'map',
    links: list(params.get('links'), LINK_KINDS),
    kinds: list(params.get('kinds'), KIND_KEYS as readonly KindKey[]),
    books: books === null ? null : books.split(',').filter((b) => /^[0-9a-f-]{36}$/i.test(b)),
    crossBook: params.get('cross') === '1',
    others: params.get('others') === 'hide' ? 'hide' : 'dim',
    group: params.get('group') === 'book' ? 'book' : 'free',
    query: (params.get('q') ?? '').slice(0, 120),
    selected: params.get('sel'),
  };
}

export function lensToParams(lens: LensState): URLSearchParams {
  const params = new URLSearchParams();
  if (lens.mode === 'lens') params.set('mode', 'lens');
  if (lens.links) params.set('links', lens.links.join(','));
  if (lens.kinds) params.set('kinds', lens.kinds.join(','));
  if (lens.books) params.set('books', lens.books.join(','));
  if (lens.crossBook) params.set('cross', '1');
  if (lens.others === 'hide') params.set('others', 'hide');
  if (lens.group === 'book') params.set('group', 'book');
  if (lens.query.trim()) params.set('q', lens.query.trim());
  if (lens.selected) params.set('sel', lens.selected);
  return params;
}

/** Turn one value of a list on or off; back to `null` (all) once every value is on. */
export function toggle<T extends string>(current: T[] | null, value: T, all: readonly T[]): T[] | null {
  const on = new Set(current ?? all);
  if (on.has(value)) on.delete(value);
  else on.add(value);
  const next = all.filter((v) => on.has(v));
  return next.length === all.length ? null : next;
}

/** Whether any filter is narrowing the view (the query aside). */
export function isFiltering(lens: LensState): boolean {
  return lens.mode === 'lens' && (lens.links !== null || lens.kinds !== null || lens.books !== null || lens.crossBook);
}

/** The lens with its filters cleared, keeping the mode, layout and selection. */
export function cleared(lens: LensState): LensState {
  return {
    ...lens,
    links: null,
    kinds: null,
    books: null,
    crossBook: false,
    query: '',
  };
}

/**
 * The command palette's model: items built from `/search/suggest` (documents, chapters
 * and concepts, each carrying what to open), and a pure reducer for open/close, typing, stale-result rejection and arrow-key movement.
 */
import type { SuggestItem } from '../../lib/api/types/search';
import { conceptHref, readerHref } from './links';
import type { RecentEntry } from './recent';
import { searchHref } from './url-state';

export type PaletteKind = 'document' | 'chapter' | 'concept' | 'search' | 'ask' | 'recent';

export interface PaletteItem {
  id: string;
  kind: PaletteKind;
  label: string;
  detail?: string;
  href: string;
}

export interface PaletteState {
  open: boolean;
  query: string;
  /** Matches for `resultsFor`; recent entries when the query is empty. */
  items: PaletteItem[];
  resultsFor: string;
  active: number;
  loading: boolean;
}

export type PaletteAction =
  | { type: 'open'; recent: PaletteItem[] }
  | { type: 'close' }
  | { type: 'query'; query: string; recent: PaletteItem[] }
  | { type: 'results'; query: string; items: PaletteItem[] }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'point'; index: number };

export const closedPalette: PaletteState = { open: false, query: '', items: [], resultsFor: '', active: 0, loading: false };

const SUGGEST_LIMIT = 10;

export function recentItems(recent: readonly RecentEntry[]): PaletteItem[] {
  return recent.map((r, i) => ({ id: `recent-${i}`, kind: 'recent', label: r.label, href: r.href }));
}

/** Where a suggestion opens: the document, the chapter in the reader, the concept page. */
function jumpHref(s: SuggestItem): string | null {
  if (s.kind === 'concept') return s.id ? conceptHref(s.id) : null;
  if (!s.document) return null;
  return readerHref(s.document.slug, s.kind === 'chapter' ? s.anchor : null);
}

/** Jump targets first (in the suggest endpoint's interleaved order), then "Search" and "Ask". */
export function buildItems(query: string, suggest: readonly SuggestItem[]): PaletteItem[] {
  const q = query.trim();
  if (!q) return [];
  const jumps = suggest.slice(0, SUGGEST_LIMIT).flatMap((s, i): PaletteItem[] => {
    const href = jumpHref(s);
    if (!href) return [];
    const detail = s.kind === 'chapter' ? s.document?.title : s.kind === 'document' ? s.document?.authors.join(', ') || undefined : undefined;
    return [{ id: `${s.kind}-${s.id ?? i}`, kind: s.kind, label: s.label, detail, href }];
  });
  return [
    ...jumps,
    { id: 'search', kind: 'search', label: `Search for “${q}”`, href: searchHref({ q }) },
    { id: 'ask', kind: 'ask', label: `Ask “${q}”`, detail: 'A cited answer from your library', href: `${searchHref({ q })}&ask=1` },
  ];
}

export function paletteReducer(state: PaletteState, action: PaletteAction): PaletteState {
  switch (action.type) {
    case 'open':
      return state.open ? state : { ...closedPalette, open: true, items: action.recent };
    case 'close':
      return closedPalette;
    case 'query': {
      const empty = !action.query.trim();
      return {
        ...state,
        query: action.query,
        items: empty ? action.recent : state.items,
        resultsFor: empty ? '' : state.resultsFor,
        loading: !empty,
        active: 0,
      };
    }
    case 'results':
      // A slow response for an older query must not replace newer results.
      if (!state.open || action.query !== state.query) return state;
      return { ...state, items: action.items, resultsFor: action.query, loading: false, active: 0 };
    case 'move': {
      const n = state.items.length;
      if (n === 0) return state;
      return { ...state, active: (state.active + action.delta + n) % n };
    }
    case 'point':
      return action.index >= 0 && action.index < state.items.length ? { ...state, active: action.index } : state;
  }
}

export function activeItem(state: PaletteState): PaletteItem | undefined {
  return state.items[state.active];
}

/** ⌘K on macOS, Ctrl-K elsewhere; both are accepted everywhere. */
export function isPaletteShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>): boolean {
  return event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

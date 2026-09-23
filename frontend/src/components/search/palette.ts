/**
 * The command palette's model: items built from `/search/suggest` + `/concepts`, and a
 * pure reducer for open/close, typing, stale-result rejection and arrow-key movement.
 */
import type { ConceptSummary } from '../../lib/api/types/graph';
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

const CONCEPT_LIMIT = 5;
const SUGGEST_LIMIT = 7;

export function recentItems(recent: readonly RecentEntry[]): PaletteItem[] {
  return recent.map((r, i) => ({ id: `recent-${i}`, kind: 'recent', label: r.label, href: r.href }));
}

/** Jump targets first (documents, chapters, concepts), then "Search" and "Ask". */
export function buildItems(query: string, suggest: readonly SuggestItem[], concepts: readonly ConceptSummary[]): PaletteItem[] {
  const q = query.trim();
  if (!q) return [];
  const jumps: PaletteItem[] = [];
  suggest
    .filter((s) => s.kind !== 'concept' && s.document)
    .slice(0, SUGGEST_LIMIT)
    .forEach((s, i) => {
      const doc = s.document;
      if (!doc) return;
      jumps.push({
        id: `${s.kind}-${i}`,
        kind: s.kind,
        label: s.label,
        detail: s.kind === 'chapter' ? doc.title : doc.authors.join(', ') || undefined,
        href: readerHref(doc.slug, s.kind === 'chapter' ? s.anchor : null),
      });
    });
  concepts.slice(0, CONCEPT_LIMIT).forEach((c) => {
    jumps.push({ id: `concept-${c.id}`, kind: 'concept', label: c.canonical, detail: c.kind, href: conceptHref(c.id) });
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

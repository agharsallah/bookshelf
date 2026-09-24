/**
 * Search state ⇄ URL, so a search is shareable and bookmarkable:
 * `/search?q=feedback+loops&mode=lexical&doc=<id>&tag=systems&type=chapter_distillation`.
 * Unknown modes and types are dropped rather than sent to the API to be refused.
 */
import { ARTIFACT_TYPES, type ArtifactType } from '../../lib/api/types/artifacts';
import { SEARCH_MODES, type SearchMode, type SearchRequest } from '../../lib/api/types/search';

export interface SearchState {
  q: string;
  mode: SearchMode;
  documents: string[];
  tags: string[];
  types: ArtifactType[];
}

export const emptySearch: SearchState = { q: '', mode: 'auto', documents: [], tags: [], types: [] };

const MAX_QUERY = 500;
/** Backend limits on `filters` (schemas/search.py); a value past them fails the whole request. */
const MAX_TAG = 64;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isMode(value: string | null): value is SearchMode {
  return value !== null && (SEARCH_MODES as readonly string[]).includes(value);
}

function isType(value: string): value is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function parseSearchParams(params: URLSearchParams): SearchState {
  const mode = params.get('mode');
  return {
    q: (params.get('q') ?? '').slice(0, MAX_QUERY),
    mode: isMode(mode) ? mode : 'auto',
    documents: unique(params.getAll('doc')).filter((d) => UUID.test(d)),
    tags: unique(params.getAll('tag')).filter((t) => t.length <= MAX_TAG),
    types: unique(params.getAll('type')).filter(isType),
  };
}

/** Canonical query string (no `?`); defaults are left out so URLs stay short. */
export function toSearchParams(state: SearchState): string {
  const params = new URLSearchParams();
  const q = state.q.trim();
  if (q) params.set('q', q);
  if (state.mode !== 'auto') params.set('mode', state.mode);
  state.documents.forEach((d) => params.append('doc', d));
  state.tags.forEach((t) => params.append('tag', t));
  state.types.forEach((t) => params.append('type', t));
  return params.toString();
}

export function searchHref(state: Partial<SearchState> & { q: string }): string {
  const qs = toSearchParams({ ...emptySearch, ...state });
  return qs ? `/search?${qs}` : '/search';
}

/** The `POST /search` body, or null when there is nothing to search for. */
export function toSearchRequest(state: SearchState, limit = 8): SearchRequest | null {
  const query = state.q.trim().slice(0, MAX_QUERY);
  if (!query) return null;
  const filters: NonNullable<SearchRequest['filters']> = {};
  if (state.documents.length) filters.document_ids = state.documents;
  if (state.tags.length) filters.tags = state.tags;
  if (state.types.length) filters.types = state.types;
  return { query, mode: state.mode, filters, limit };
}

export function activeFilterCount(state: SearchState): number {
  return state.documents.length + state.tags.length + state.types.length;
}

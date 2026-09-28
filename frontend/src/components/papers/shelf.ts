/**
 * The paper shelf's filters live in the URL (`/papers?venue=NeurIPS&stars=4&pass=0&sort=year`),
 * so the page is server-rendered, linkable and works without JavaScript. The same
 * values go to `GET /papers` (its `min_stars` is `stars` here, the URL's shorter name).
 */
import {
  PAPER_SORTS,
  PAPER_VERDICTS,
  type PaperArtifactState,
  type PaperQuery,
  type PaperSort,
  type PaperVerdict,
  type PassNumber,
} from '../../lib/api/types/papers';
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import { pickBest } from '../../lib/documents/artifacts';
import { TYPE_LABELS } from '../review/labels';
import { parsePaperCard } from './bodies';
import { PASS_LABELS, VERDICT_LABELS } from './labels';

export interface ShelfFilters {
  q: string | null;
  venue: string | null;
  year: number | null;
  /** At least this many stars in your latest rating. */
  stars: number | null;
  /** 0: not started; n: the highest pass completed. */
  pass: 0 | PassNumber | null;
  verdict: PaperVerdict | null;
  sort: PaperSort;
}

export const DEFAULT_SORT: PaperSort = 'recent';

export const SORT_LABELS: Record<PaperSort, string> = {
  recent: 'Recently added',
  title: 'Title',
  year: 'Newest first',
  stars: 'Your stars',
  cited_by: 'Most cited',
};

export const NO_FILTERS: ShelfFilters = { q: null, venue: null, year: null, stars: null, pass: null, verdict: null, sort: DEFAULT_SORT };

const FILTER_KEYS = ['q', 'venue', 'year', 'stars', 'pass', 'verdict'] as const satisfies readonly (keyof ShelfFilters)[];

function text(value: string | null, max: number): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed.slice(0, max) : null;
}

function int(value: string | null, min: number, max: number): number | null {
  if (value === null || !/^-?\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

function oneOf<T extends string>(values: readonly T[], value: string | null): T | null {
  return value !== null && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** Read filters from the URL; unknown or out-of-range values are dropped. */
export function parseShelfFilters(params: URLSearchParams): ShelfFilters {
  return {
    q: text(params.get('q'), 200),
    venue: text(params.get('venue'), 500),
    year: int(params.get('year'), -3000, 3000),
    stars: int(params.get('stars'), 1, 5),
    pass: int(params.get('pass'), 0, 3) as ShelfFilters['pass'],
    verdict: oneOf(PAPER_VERDICTS, params.get('verdict')),
    sort: oneOf(PAPER_SORTS, params.get('sort')) ?? DEFAULT_SORT,
  };
}

/** The `GET /papers` query (unset filters omitted). */
export function papersQuery(filters: ShelfFilters, limit = 100): PaperQuery {
  const query: PaperQuery = { limit, sort: filters.sort };
  if (filters.q !== null) query.q = filters.q;
  if (filters.venue !== null) query.venue = filters.venue;
  if (filters.year !== null) query.year = filters.year;
  if (filters.stars !== null) query.min_stars = filters.stars;
  if (filters.pass !== null) query.pass = filters.pass;
  if (filters.verdict !== null) query.verdict = filters.verdict;
  return query;
}

/** A `/papers` link with some filters changed (`null` clears one); the default sort is left out. */
export function shelfHref(filters: ShelfFilters, change: Partial<ShelfFilters> = {}, base = '/papers'): string {
  const next = { ...filters, ...change };
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = next[key];
    if (value !== null) params.set(key, String(value));
  }
  if (next.sort !== DEFAULT_SORT) params.set('sort', next.sort);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function hasShelfFilters(filters: ShelfFilters): boolean {
  return FILTER_KEYS.some((key) => filters[key] !== null);
}

export function passFilterLabel(pass: 0 | PassNumber): string {
  return pass === 0 ? 'Not started' : `Pass ${pass}: ${PASS_LABELS[pass].name.toLowerCase()}`;
}

/** The filters in force, each with a link that removes it (the "active filter" chips). */
export function activeFilters(filters: ShelfFilters): { label: string; clearHref: string }[] {
  const chips: { label: string; clearHref: string }[] = [];
  const add = (label: string, change: Partial<ShelfFilters>) => chips.push({ label, clearHref: shelfHref(filters, change) });
  if (filters.q !== null) add(`“${filters.q}”`, { q: null });
  if (filters.venue !== null) add(filters.venue, { venue: null });
  if (filters.year !== null) add(String(filters.year), { year: null });
  if (filters.stars !== null) add(`${filters.stars}+ stars`, { stars: null });
  if (filters.pass !== null) add(passFilterLabel(filters.pass), { pass: null });
  if (filters.verdict !== null) add(VERDICT_LABELS[filters.verdict], { verdict: null });
  return chips;
}

/** "3 papers", or "1 of 3 papers" while filtering. */
export function shelfSummary(shown: number, total: number, filtered: boolean): string {
  const papers = `${total} ${total === 1 ? 'paper' : 'papers'}`;
  return filtered ? `${shown} of ${papers}` : papers;
}

export interface ArtifactChip {
  label: string;
  /** `approved` is solid; `draft` waits for review. */
  standing: 'approved' | 'draft';
}

/**
 * What a paper already has, one chip per artifact type in the shelf's order; variants
 * (explainer levels) fold into one chip that counts them.
 */
export function artifactChips(artifacts: readonly PaperArtifactState[]): ArtifactChip[] {
  const byType = new Map<PaperArtifactState['type'], PaperArtifactState[]>();
  for (const a of artifacts) {
    if (a.review === 'rejected') continue;
    byType.set(a.type, [...(byType.get(a.type) ?? []), a]);
  }
  return [...byType].map(([type, found]) => {
    const variants = found.filter((a) => a.variant !== null).length;
    return {
      label: variants > 1 ? `${TYPE_LABELS[type]} (${variants} levels)` : TYPE_LABELS[type],
      standing: found.some((a) => a.review === 'approved') ? 'approved' : 'draft',
    };
  });
}

/** Characters of a tl;dr shown on a shelf card before it is cut at a word. */
export const TLDR_CHARS = 260;

/** Plain text cut to `max` characters at a word boundary, with an ellipsis when cut. */
export function clip(text: string, max = TLDR_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).replace(/[\s,;:.]+$/, '')}…`;
}

/** Each paper's tl;dr (from its best card: approved, else the newest draft), as plain text. */
export function tldrByDocument(cards: readonly ArtifactPublic[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const documentId of new Set(cards.map((c) => c.document_id))) {
    const best = pickBest(
      cards.filter((c) => c.document_id === documentId),
      'paper_card',
      null,
    );
    const text = best ? parsePaperCard(best.artifact.body).tldr.map((s) => s.text).join(' ') : '';
    if (text.trim()) out[documentId] = clip(text);
  }
  return out;
}

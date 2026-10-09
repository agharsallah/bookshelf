/**
 * Feed configs (docs/PILLS.md §6): the defaults, and the URL presets every entry point
 * links with (`/pills?document=meadows-systems&length=10`). Parsing is forgiving: an
 * unknown mode, length or kind is dropped, never an error, so a hand-edited link still
 * opens a feed.
 *
 * Query keys: `document`, `collection`, `paper_set`, `concept` (repeatable, or comma
 * separated), `genre`, `mode`, `kinds` (comma separated), `length` (10 · 20 · 40 ·
 * `endless`), `spoilers` (1).
 */
import { FEED_LENGTHS, FEED_MODES, PILL_KINDS, type FeedConfig, type FeedLength, type FeedMode, type FeedSources, type PillGenre, type PillKind } from './types';

export const DEFAULT_LENGTH = 20;

export function defaultConfig(): FeedConfig {
  return {
    sources: { documents: [], collections: [], paper_sets: [], concepts: [], genre: null },
    mode: 'consolidate',
    kinds: null,
    length: DEFAULT_LENGTH,
    spoilers: false,
  };
}

/** The query keys of the source lists. */
const SOURCE_KEYS = {
  documents: 'document',
  collections: 'collection',
  paper_sets: 'paper_set',
  concepts: 'concept',
} as const satisfies Record<Exclude<keyof FeedSources, 'genre'>, string>;

const GENRES: readonly PillGenre[] = ['book', 'paper', 'article'];

/** What the parser needs of `URLSearchParams`. */
export interface QueryLike {
  getAll(key: string): string[];
  get(key: string): string | null;
}

const listOf = (query: QueryLike, key: string): string[] => {
  const values = query
    .getAll(key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(values)];
};

export function parseLength(raw: string | null): FeedLength | undefined {
  if (raw === null) return undefined;
  if (raw === 'endless') return null;
  const n = Number(raw);
  return (FEED_LENGTHS as readonly number[]).includes(n) ? (n as FeedLength) : undefined;
}

export function isMode(raw: string | null): raw is FeedMode {
  return raw !== null && (FEED_MODES as readonly string[]).includes(raw);
}

export function isKind(raw: string): raw is PillKind {
  return (PILL_KINDS as readonly string[]).includes(raw);
}

/** A config from URL presets, over the defaults. */
export function configFromQuery(query: QueryLike, base: FeedConfig = defaultConfig()): FeedConfig {
  const sources: FeedSources = { ...base.sources };
  for (const [field, key] of Object.entries(SOURCE_KEYS) as [keyof typeof SOURCE_KEYS, string][]) {
    const values = listOf(query, key);
    if (values.length > 0) sources[field] = values;
  }
  const genre = query.get('genre');
  if (genre && (GENRES as readonly string[]).includes(genre)) sources.genre = genre as PillGenre;

  const mode = query.get('mode');
  const length = parseLength(query.get('length'));
  const kinds = listOf(query, 'kinds').filter(isKind);
  const spoilers = query.get('spoilers');
  return {
    sources,
    mode: isMode(mode) ? mode : base.mode,
    kinds: kinds.length > 0 ? kinds : base.kinds,
    length: length === undefined ? base.length : length,
    spoilers: spoilers === null ? base.spoilers : spoilers === '1' || spoilers === 'true',
  };
}

/** The presets that differ from the defaults, as `[key, value]` pairs in a stable order. */
export function configToEntries(config: FeedConfig): [string, string][] {
  const defaults = defaultConfig();
  const out: [string, string][] = [];
  for (const [field, key] of Object.entries(SOURCE_KEYS) as [keyof typeof SOURCE_KEYS, string][]) {
    for (const value of config.sources[field]) out.push([key, value]);
  }
  if (config.sources.genre) out.push(['genre', config.sources.genre]);
  if (config.mode !== defaults.mode) out.push(['mode', config.mode]);
  const kinds = config.kinds;
  if (kinds && kinds.length > 0) out.push(['kinds', PILL_KINDS.filter((k) => kinds.includes(k)).join(',')]);
  if (config.length !== defaults.length) out.push(['length', config.length === null ? 'endless' : String(config.length)]);
  if (config.spoilers) out.push(['spoilers', '1']);
  return out;
}

/** `?document=…&length=10`, or '' for the default feed. */
export function configToQuery(config: FeedConfig): string {
  const entries = configToEntries(config);
  if (entries.length === 0) return '';
  return `?${entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}`;
}

/** A link to the feed with these presets, e.g. for an entry card. */
export function pillsHref(presets: Partial<Omit<FeedConfig, 'sources'>> & { sources?: Partial<FeedSources> } = {}, path = '/pills'): string {
  const base = defaultConfig();
  const config: FeedConfig = { ...base, ...presets, sources: { ...base.sources, ...presets.sources } };
  return `${path}${configToQuery(config)}`;
}

/** Whether the config draws from the whole shelf. */
export function isWholeShelf(config: FeedConfig): boolean {
  const { genre, ...lists } = config.sources;
  return genre === null && Object.values(lists).every((list) => list.length === 0);
}

/** Two configs ask for the same feed (saved-feed chips mark the one in use); list order aside from kinds counts. */
export function sameConfig(a: FeedConfig, b: FeedConfig): boolean {
  return configToQuery(a) === configToQuery(b);
}

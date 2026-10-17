/**
 * Reading progress in the read-only demo (docs/DEMO.md): where a visitor is in each
 * chapter, and the documents they marked finished, kept in this browser instead of
 * `PUT /documents/{ref}/reading`. The pages merge it over what the server rendered.
 */
import type { ReadingPosition } from '../api/types/documents';

export const LOCAL_READING_KEY = 'bookshelf:demo:reading';

interface DocumentReading {
  positions: Record<string, ReadingPosition>;
  finished_at: string | null;
}

type Store = Record<string, DocumentReading>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

export interface LocalReadingOptions {
  storage?: Storage;
  now?: () => Date;
}

const defaults = (options: LocalReadingOptions) => ({ storage: options.storage ?? globalThis.localStorage, now: options.now ?? (() => new Date()) });

function load(storage: Storage | undefined): Store {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(LOCAL_READING_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function store(storage: Storage | undefined, value: Store): void {
  try {
    storage?.setItem(LOCAL_READING_KEY, JSON.stringify(value));
  } catch {
    // Progress is a convenience: a full or blocked store just keeps the previous place.
  }
}

function entry(all: Store, slug: string): DocumentReading {
  return all[slug] ?? { positions: {}, finished_at: null };
}

/** Where you are in a chapter; how far you got never goes back. */
export function saveLocalPosition(slug: string, body: Pick<ReadingPosition, 'unit' | 'anchor' | 'progress'>, options: LocalReadingOptions = {}): void {
  const { storage, now } = defaults(options);
  const all = load(storage);
  const doc = entry(all, slug);
  const before = doc.positions[body.unit]?.progress ?? 0;
  doc.positions[body.unit] = { ...body, progress: Math.max(before, body.progress), updated_at: now().toISOString() };
  store(storage, { ...all, [slug]: doc });
}

export function setLocalFinished(slug: string, finished: boolean, options: LocalReadingOptions = {}): void {
  const { storage, now } = defaults(options);
  const all = load(storage);
  store(storage, { ...all, [slug]: { ...entry(all, slug), finished_at: finished ? now().toISOString() : null } });
}

export function localReading(slug: string, options: LocalReadingOptions = {}): { positions: ReadingPosition[]; finished_at: string | null } {
  const doc = entry(load(defaults(options).storage), slug);
  return { positions: Object.values(doc.positions), finished_at: doc.finished_at };
}

/** The server's positions with the browser's over them: per chapter the newer place, the furthest progress. */
export function mergePositions(server: readonly ReadingPosition[], local: readonly ReadingPosition[]): ReadingPosition[] {
  const byUnit = new Map(server.map((p) => [p.unit, p]));
  for (const mine of local) {
    const theirs = byUnit.get(mine.unit);
    if (!theirs) byUnit.set(mine.unit, mine);
    else {
      const newer = mine.updated_at >= theirs.updated_at ? mine : theirs;
      byUnit.set(mine.unit, { ...newer, progress: Math.max(mine.progress, theirs.progress) });
    }
  }
  return [...byUnit.values()];
}

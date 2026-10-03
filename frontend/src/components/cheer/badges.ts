/**
 * Badges: what your reading has earned, from the all-history reader statistics. A tiered
 * badge (books finished, a streak, words read…) climbs through levels at fixed thresholds;
 * a single badge (a long sitting, a sharp memory) is earned once. Each says how close the
 * next level is, so the collection doubles as a list of what to aim for. Pure functions.
 */
import type { HourCell, LibraryReaderStats, Totals } from '../../lib/api/types/readerStats';

/** What a badge is computed from: the all-history statistics (not a narrowed window). */
export type BadgeSource = Pick<LibraryReaderStats, 'totals' | 'hours' | 'depth'>;

interface TieredDef {
  id: string;
  kind: 'tiered';
  /** Quiet name, playful name, and the playful mark. */
  name: string;
  playful: string;
  emoji: string;
  /** "7 days in a row", for a threshold. */
  unit: (n: number) => string;
  thresholds: readonly number[];
  value: (s: BadgeSource) => number;
}

interface SingleDef {
  id: string;
  kind: 'single';
  name: string;
  playful: string;
  emoji: string;
  /** What earns it. */
  goal: string;
  /** 0–1 of the way there. */
  progress: (s: BadgeSource) => number;
}

export type BadgeDef = TieredDef | SingleDef;

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
const compact = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}k` : String(n));
const HOUR = 3600;

/** Share of tracked seconds in the hours `from` (inclusive) to `to` (exclusive), wrapping midnight. */
export function hoursShare(hours: readonly HourCell[], from: number, to: number): number {
  const inside = (h: number) => (from <= to ? h >= from && h < to : h >= from || h < to);
  const total = hours.reduce((sum, c) => sum + c.seconds, 0);
  return total === 0 ? 0 : hours.reduce((sum, c) => sum + (inside(c.hour) ? c.seconds : 0), 0) / total;
}

const totals = (pick: (t: Totals) => number) => (s: BadgeSource) => pick(s.totals);
/** A time-of-day badge needs some time behind it before a share means anything. */
const MIN_TIMED_SECONDS = 5 * HOUR;
const timeOfDay = (from: number, to: number) => (s: BadgeSource) =>
  Math.min(1, s.totals.seconds / MIN_TIMED_SECONDS) * Math.min(1, hoursShare(s.hours, from, to) / 0.3);

export const BADGES: readonly BadgeDef[] = [
  {
    id: 'streak', kind: 'tiered', name: 'Steady hand', playful: 'Hot streak', emoji: '🔥',
    unit: (n) => `${count(n, 'day')} in a row`, thresholds: [3, 7, 14, 30, 60, 100, 365],
    value: totals((t) => t.longest_streak),
  },
  {
    id: 'books', kind: 'tiered', name: 'Finished shelf', playful: 'Bookworm', emoji: '📚',
    unit: (n) => `${count(n, 'book')} finished`, thresholds: [1, 3, 5, 10, 25, 50, 100],
    value: totals((t) => t.books_finished),
  },
  {
    id: 'chapters', kind: 'tiered', name: 'Chapter by chapter', playful: 'Page turner', emoji: '📖',
    unit: (n) => `${count(n, 'chapter')} finished`, thresholds: [1, 10, 25, 50, 100, 250, 500],
    value: totals((t) => t.chapters_finished),
  },
  {
    id: 'words', kind: 'tiered', name: 'Ground covered', playful: 'Word muncher', emoji: '🐛',
    unit: (n) => `${compact(n)} words read`, thresholds: [10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000],
    value: totals((t) => t.words_read),
  },
  {
    id: 'time', kind: 'tiered', name: 'Hours with books', playful: 'Time traveller', emoji: '⏳',
    unit: (n) => `${count(n / HOUR, 'hour')} with books`, thresholds: [1, 10, 25, 50, 100, 250, 500].map((h) => h * HOUR),
    value: totals((t) => t.seconds),
  },
  {
    id: 'days', kind: 'tiered', name: 'Days of reading', playful: 'Regular', emoji: '📅',
    unit: (n) => `${count(n, 'day')} with books`, thresholds: [7, 30, 100, 200, 365],
    value: totals((t) => t.active_days),
  },
  {
    id: 'marginalia', kind: 'tiered', name: 'In the margins', playful: 'Highlighter hero', emoji: '🖍️',
    unit: (n) => `${count(n, 'note')} and highlights`, thresholds: [1, 25, 100, 250, 500, 1000],
    value: totals((t) => t.notes + t.highlights),
  },
  {
    id: 'recalls', kind: 'tiered', name: 'From memory', playful: 'Brain flex', emoji: '🧠',
    unit: (n) => `${count(n, 'recall')}`, thresholds: [1, 5, 25, 50, 100, 250],
    value: totals((t) => t.recalls),
  },
  {
    id: 'predictions', kind: 'tiered', name: 'Before you read', playful: 'Fortune teller', emoji: '🔮',
    unit: (n) => `${count(n, 'prediction')}`, thresholds: [1, 10, 25, 50, 100],
    value: totals((t) => t.predictions),
  },
  {
    id: 'reviews', kind: 'tiered', name: 'Spaced and kept', playful: 'Card shark', emoji: '🃏',
    unit: (n) => `${count(n, 'review')}`, thresholds: [10, 100, 500, 1000, 2500, 5000],
    value: totals((t) => t.reviews),
  },
  {
    id: 'marathon', kind: 'single', name: 'The long sitting', playful: 'Marathoner', emoji: '🏃',
    goal: 'An hour or more in one sitting',
    progress: (s) => Math.min(1, (s.totals.longest_session_seconds ?? 0) / HOUR),
  },
  {
    id: 'memory', kind: 'single', name: 'A good memory', playful: 'Elephant', emoji: '🐘',
    goal: '90% of 50 or more reviews remembered',
    progress: (s) => Math.min(1, s.totals.reviews / 50) * Math.min(1, (s.totals.retention ?? 0) / 0.9),
  },
  {
    id: 'deep', kind: 'single', name: 'All the way down', playful: 'Deep diver', emoji: '🤿',
    goal: 'A book read, annotated, recalled and reviewed',
    progress: (s) => {
      const reached = s.depth.filter((d) => d.books > 0).length;
      return reached / Math.max(1, s.depth.length);
    },
  },
  {
    id: 'owl', kind: 'single', name: 'By lamplight', playful: 'Night owl', emoji: '🦉',
    goal: 'A third of your reading after 10 pm',
    progress: timeOfDay(22, 4),
  },
  {
    id: 'lark', kind: 'single', name: 'First light', playful: 'Early bird', emoji: '🐦',
    goal: 'A third of your reading before 8 am',
    progress: timeOfDay(5, 8),
  },
];

export interface BadgeStatus {
  def: BadgeDef;
  /** Levels earned: 0 is locked; a single badge has one level. */
  level: number;
  levels: number;
  /** What the current level (or, while locked, the first) says: "7 days in a row". */
  label: string;
  /** The next level's line, or null at the top. */
  next: string | null;
  /** 0–1 of the way from the current level to the next; 1 at the top. */
  progress: number;
}

function tiered(def: TieredDef, s: BadgeSource): BadgeStatus {
  const value = def.value(s);
  const level = def.thresholds.filter((t) => value >= t).length;
  const levels = def.thresholds.length;
  const floor = def.thresholds[level - 1] ?? 0;
  const ceiling = def.thresholds[level];
  return {
    def,
    level,
    levels,
    label: def.unit(def.thresholds[Math.max(0, level - 1)] ?? 0),
    next: ceiling === undefined ? null : def.unit(ceiling),
    progress: ceiling === undefined ? 1 : Math.max(0, Math.min(1, (value - floor) / (ceiling - floor))),
  };
}

function single(def: SingleDef, s: BadgeSource): BadgeStatus {
  const progress = def.progress(s);
  const earned = progress >= 1;
  return { def, level: earned ? 1 : 0, levels: 1, label: def.goal, next: earned ? null : def.goal, progress: earned ? 1 : progress };
}

export function badgeStatuses(s: BadgeSource, defs: readonly BadgeDef[] = BADGES): BadgeStatus[] {
  return defs.map((def) => (def.kind === 'tiered' ? tiered(def, s) : single(def, s)));
}

/** The badges closest to their next level, nearest first; maxed ones left out. */
export function upNext(statuses: readonly BadgeStatus[], limit = 3): BadgeStatus[] {
  return statuses
    .filter((b) => b.next !== null)
    .sort((a, b) => b.progress - a.progress)
    .slice(0, limit);
}

/** Levels earned across the collection, of all there are. */
export function collectionScore(statuses: readonly BadgeStatus[]): { earned: number; total: number } {
  return statuses.reduce((acc, b) => ({ earned: acc.earned + b.level, total: acc.total + b.levels }), { earned: 0, total: 0 });
}

/** `{ id: level }`, what was last seen, to tell a level earned since. */
export type SeenLevels = Readonly<Record<string, number>>;

export const SEEN_STORAGE_KEY = 'bookshelf:badges-seen';

export function newlyEarned(statuses: readonly BadgeStatus[], seen: SeenLevels | null): BadgeStatus[] {
  // The first visit sets the baseline: everything already earned is not news.
  if (!seen) return [];
  return statuses.filter((b) => b.level > (seen[b.def.id] ?? 0));
}

export const seenLevels = (statuses: readonly BadgeStatus[]): SeenLevels => Object.fromEntries(statuses.map((b) => [b.def.id, b.level]));

export function readSeen(storage: Pick<Storage, 'getItem'>): SeenLevels | null {
  try {
    const raw = storage.getItem(SEEN_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SeenLevels) : null;
  } catch {
    return null;
  }
}

export function saveSeen(storage: Pick<Storage, 'setItem'>, levels: SeenLevels): void {
  try {
    storage.setItem(SEEN_STORAGE_KEY, JSON.stringify(levels));
  } catch {
    // Best-effort: at worst a badge is announced again.
  }
}

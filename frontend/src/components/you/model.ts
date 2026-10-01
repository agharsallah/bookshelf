/**
 * Reader statistics → what the charts draw. Pure: the API's shapes in, chart inputs out.
 *
 * Every surface keeps one color everywhere (`SURFACES`), whatever else a chart shows. Dates
 * are the API's local `YYYY-MM-DD` days; `localDay` and `localHour` read a timestamp in the
 * same time zone, so sessions line up with the days they belong to.
 */
import type { BarRow } from '../charts/HBars';
import type { Series } from '../charts/chart';
import { OTHER, SLOTS } from '../charts/chart';
import type { Column } from '../charts/StackedColumns';
import type { Sitting } from '../charts/SessionStrip';
import type { TreeGroup } from '../charts/Treemap';
import type { ScatterPoint } from '../charts/Scatter';
import type { BookRow, ChapterRow, DayPoint, Depth, ReaderStats, Session, Surface, SurfaceSeconds, Tone } from '../../lib/api/types/readerStats';

export const SURFACES: readonly (Series & { key: Surface; hint: string })[] = [
  { key: 'read', label: 'Reading', color: SLOTS[0], hint: 'the source text in the reader' },
  { key: 'listen', label: 'Listening', color: SLOTS[1], hint: 'chapters read aloud and episodes' },
  { key: 'study', label: 'Study', color: SLOTS[2], hint: 'quiz, flashcards, FAQ, glossary, quotes' },
  { key: 'recall', label: 'Recall', color: SLOTS[3], hint: 'chapters written from memory' },
  { key: 'review', label: 'Review', color: SLOTS[4], hint: 'spaced reviews on Today' },
  { key: 'distill', label: 'Brief & guide', color: SLOTS[5], hint: 'what the pipeline wrote' },
  { key: 'explore', label: 'Exploring', color: OTHER, hint: 'search, concepts, the map' },
];

/** The surfaces that have time in `seconds`, in their fixed order. */
export function surfacesIn(...seconds: SurfaceSeconds[]): Series[] {
  return SURFACES.filter((s) => seconds.some((v) => (v[s.key] ?? 0) > 0));
}

export const DAY_MS = 86_400_000;
const parseDay = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => new Date(parseDay(day) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((parseDay(to) - parseDay(from)) / DAY_MS);

/** `at` as a local day in `tz`, `YYYY-MM-DD`. */
export function localDay(at: string | Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
}

/** Hours since local midnight of `day`, in `tz` (past 24 for a time on a later day). */
export function localHour(at: string | Date, tz: string, day: string): number {
  const date = new Date(at);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const hours = Number(parts.hour) + Number(parts.minute) / 60;
  return hours + daysBetween(day, localDay(date, tz)) * 24;
}

/** The days a view covers: its window, or everything since the first thing that happened. */
export function viewRange(stats: Pick<ReaderStats, 'generated_at' | 'tz' | 'days' | 'daily'>, cap = 371): { from: string; to: string } {
  const to = localDay(stats.generated_at, stats.tz);
  const first = stats.daily[0]?.date ?? to;
  const from = stats.days ? addDays(to, 1 - stats.days) : first;
  return { from: daysBetween(from, to) > cap ? addDays(to, -cap) : from, to };
}

export const dayTotal = (d: Pick<DayPoint, 'seconds'>) => Object.values(d.seconds).reduce<number>((s, v) => s + (v ?? 0), 0);

/** Monday of `day`'s week. */
export function weekOf(day: string): string {
  const weekday = (new Date(parseDay(day)).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

const short = (day: string) => new Date(parseDay(day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Time per column by surface over `from`–`to`: one column a day up to `dailyUpTo` days,
 * one a week beyond, so a year still reads. Empty days and weeks are kept (a gap is data).
 */
export function timeColumns(daily: readonly DayPoint[], from: string, to: string, dailyUpTo = 45): Column[] {
  const byWeek = daysBetween(from, to) + 1 > dailyUpTo;
  const bucket = (day: string) => (byWeek ? weekOf(day) : day);
  const columns = new Map<string, Column>();
  for (let day = bucket(from); day <= to; day = addDays(day, byWeek ? 7 : 1)) {
    columns.set(day, { key: day, label: short(day), title: byWeek ? `Week of ${short(day)}` : new Date(parseDay(day)).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }), values: {} });
  }
  for (const point of daily) {
    if (point.date < from || point.date > to) continue;
    const column = columns.get(bucket(point.date));
    if (!column) continue;
    for (const [surface, seconds] of Object.entries(point.seconds)) column.values[surface] = (column.values[surface] ?? 0) + (seconds ?? 0);
  }
  return [...columns.values()];
}

/** A count per day (notes, reviews, recalls) as single-series columns over the range. */
export function countColumns(daily: readonly DayPoint[], key: 'notes' | 'reviews' | 'recalls', from: string, to: string): Column[] {
  return timeColumns(
    daily.map((d) => ({ ...d, seconds: { read: d[key] } })),
    from,
    to,
  ).map((c) => ({ ...c, values: { [key]: c.values.read ?? 0 } }));
}

/** The surface a session spent most time on. */
export function mainSurface(surfaces: SurfaceSeconds): Surface {
  const ranked = Object.entries(surfaces).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0));
  return (ranked[0]?.[0] as Surface | undefined) ?? 'read';
}

/** Sessions of the last `days` days, placed on their local day and hours. */
export function sittings(sessions: readonly Session[], tz: string, to: string, days: number, format: (s: number) => string, titles: Record<string, string>): { days: string[]; sittings: Sitting[] } {
  const from = addDays(to, 1 - days);
  const out: Sitting[] = [];
  for (const s of sessions) {
    const day = localDay(s.start, tz);
    if (day < from || day > to) continue;
    const start = localHour(s.start, tz, day);
    const time = (at: string) => new Date(at).toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
    out.push({
      key: s.start,
      day,
      from: start,
      to: Math.max(start + 0.05, localHour(s.end, tz, day)),
      series: mainSurface(s.surfaces),
      title: `${time(s.start)}–${time(s.end)} · ${format(s.seconds)}`,
      rows: [
        ...SURFACES.filter((x) => (s.surfaces[x.key] ?? 0) > 0).map((x) => ({ label: x.label, value: format(s.surfaces[x.key] ?? 0), color: x.color })),
        ...s.documents.slice(0, 3).map((d) => ({ label: 'book', value: titles[d] ?? d })),
      ],
    });
  }
  return { days: Array.from({ length: days }, (_, i) => addDays(to, -i)), sittings: out };
}

/** The first books keep categorical slots in the order given; the rest share "other". */
export function bookColors(slugs: readonly string[]): Record<string, string> {
  return Object.fromEntries(slugs.map((slug, i) => [slug, SLOTS[i] ?? OTHER]));
}

export const readHref = (document: string, anchor: string) => `/documents/${document}/read/${anchor}`;

export function chapterTime(c: Pick<ChapterRow, 'read_seconds' | 'listen_seconds' | 'other_seconds'>): number {
  return c.read_seconds + c.listen_seconds + c.other_seconds;
}

/** Time by book, then chapter, for the treemap: books by time, most first. */
export function treemapGroups(chapters: readonly ChapterRow[], colors: Record<string, string>): TreeGroup[] {
  const groups = new Map<string, TreeGroup>();
  for (const c of chapters) {
    const value = chapterTime(c);
    if (value <= 0) continue;
    const group = groups.get(c.document) ?? { key: c.document, label: c.book_title, color: colors[c.document] ?? OTHER, leaves: [] };
    group.leaves.push({ key: c.anchor, label: c.title, value, href: readHref(c.document, c.anchor) });
    groups.set(c.document, group);
  }
  const total = (g: TreeGroup) => g.leaves.reduce((s, l) => s + l.value, 0);
  return [...groups.values()].sort((a, b) => total(b) - total(a));
}

/** Chapters with reading time: words across, minutes up, notes as size. */
export function chapterPoints(chapters: readonly ChapterRow[], colors: Record<string, string>): ScatterPoint[] {
  return chapters
    .filter((c) => c.read_seconds > 0 && c.words > 0)
    .map((c) => ({
      key: `${c.document}:${c.anchor}`,
      x: Math.round(c.words * Math.max(c.progress, 0.01)),
      y: c.read_seconds / 60,
      size: c.notes + c.highlights,
      title: c.title,
      href: readHref(c.document, c.anchor),
      color: colors[c.document] ?? OTHER,
      rows: [
        { label: 'book', value: c.book_title },
        { label: 'words per minute', value: c.words_per_minute ? String(Math.round(c.words_per_minute)) : '—' },
        { label: 'notes and highlights', value: String(c.notes + c.highlights) },
      ],
    }));
}

/** Books by time, stacked by surface. */
export function bookBars(books: readonly BookRow[], format: (s: number) => string): BarRow[] {
  return books
    .filter((b) => b.total_seconds > 0)
    .sort((a, b) => b.total_seconds - a.total_seconds)
    .map((b) => ({ key: b.slug, label: b.title, sub: `${Math.round(b.progress * 100)}% read · ${STATE_LABELS[b.state]}`, href: `/you/${b.slug}`, values: b.seconds, valueLabel: format(b.total_seconds) }));
}

export const STATE_LABELS: Record<BookRow['state'], string> = { unread: 'not started', reading: 'reading', stalled: 'stalled', finished: 'finished' };

export const DEPTH_LABELS: Record<Depth, string> = {
  opened: 'Opened',
  read: 'Read a quarter',
  annotated: 'Annotated',
  recalled: 'Recalled',
  reviewed: 'Reviewed',
};

export const TONES: Record<Tone, { icon: string; label: string }> = {
  attention: { icon: '!', label: 'Needs you' },
  positive: { icon: '✓', label: 'Going well' },
  neutral: { icon: 'i', label: 'Noticed' },
};

export const NOTE_COLORS: Record<string, string> = {
  amber: 'var(--hl-amber)',
  rose: 'var(--hl-rose)',
  sage: 'var(--hl-sage)',
  sky: 'var(--hl-sky)',
  violet: 'var(--hl-violet)',
  none: 'var(--series-other)',
};

export const RANGES: readonly { days: number | null; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: 'Year' },
  { days: null, label: 'All time' },
];

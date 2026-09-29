/**
 * The library's days of work as a chart reads them: a contiguous run of days (quiet
 * days as zeros) over a chosen range, each day's value in the chosen metric split into
 * the part that finished and the part that failed, and the few figures that summarize
 * the range. Pure, so it is testable without a DOM; days are UTC `YYYY-MM-DD`.
 */
import type { ActivityDay } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatUsd } from './format';

export type ActivityMetric = 'compute' | 'tokens' | 'jobs' | 'cost';
export type ActivityRange = '14' | '30' | '90' | 'all';

export const METRIC_LABELS: Record<ActivityMetric, string> = { compute: 'Compute time', tokens: 'Tokens', jobs: 'Jobs', cost: 'Cost' };
export const RANGE_LABELS: Record<ActivityRange, string> = { '14': '14 days', '30': '30 days', '90': '90 days', all: 'All' };

const DAY_MS = 86_400_000;

function toTime(day: string): number {
  return Date.parse(`${day}T00:00:00Z`);
}

function toDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

export function emptyDay(day: string): ActivityDay {
  return { day, jobs: 0, failed: 0, compute_ms: 0, failed_ms: 0, tokens: 0, cost_usd: null, books: 0 };
}

/** Every day of `range` ending on `end` (or since the first active day for `all`). */
export function fillDays(days: readonly ActivityDay[], end: string, range: ActivityRange): ActivityDay[] {
  const last = Math.max(toTime(end), ...days.map((d) => toTime(d.day)));
  const first = range === 'all' ? Math.min(last, ...days.map((d) => toTime(d.day))) : last - (Number(range) - 1) * DAY_MS;
  const known = new Map(days.map((d) => [d.day, d]));
  const out: ActivityDay[] = [];
  for (let t = first; t <= last; t += DAY_MS) {
    const day = toDay(t);
    out.push(known.get(day) ?? emptyDay(day));
  }
  return out;
}

/** The shortest range that holds every recorded day, so a young library is not a row
 * of empty days; 90 days when the history is longer. */
export function fittingRange(days: readonly ActivityDay[], end: string): ActivityRange {
  const first = Math.min(toTime(end), ...days.map((d) => toTime(d.day)));
  const span = (toTime(end) - first) / DAY_MS + 1;
  return (['14', '30', '90'] as const).find((r) => Number(r) >= span) ?? '90';
}

/** A day's value in `metric`: what finished, and what went on failed jobs. */
export function dayParts(day: ActivityDay, metric: ActivityMetric): { ok: number; failed: number } {
  switch (metric) {
    case 'compute':
      return { ok: day.compute_ms - day.failed_ms, failed: day.failed_ms };
    case 'jobs':
      return { ok: day.jobs - day.failed, failed: day.failed };
    case 'tokens':
      return { ok: day.tokens, failed: 0 };
    case 'cost':
      return { ok: day.cost_usd ?? 0, failed: 0 };
  }
}

export function dayValue(day: ActivityDay, metric: ActivityMetric): number {
  const { ok, failed } = dayParts(day, metric);
  return ok + failed;
}

/** Whether the metric has a failed part worth a second series. */
export function splitsFailures(metric: ActivityMetric): boolean {
  return metric === 'compute' || metric === 'jobs';
}

export function formatMetric(value: number, metric: ActivityMetric): string {
  switch (metric) {
    case 'compute':
      return formatDuration(value);
    case 'tokens':
      return formatCount(value);
    case 'jobs':
      return formatCount(value);
    case 'cost':
      return formatUsd(value);
  }
}

export interface ActivitySummary {
  total: number;
  days: number;
  activeDays: number;
  busiest: ActivityDay | null;
  perActiveDay: number | null;
  books: number;
}

/** The range in a few figures; `books` is the most worked on in one day. */
export function summarize(days: readonly ActivityDay[], metric: ActivityMetric): ActivitySummary {
  const active = days.filter((d) => d.jobs > 0 || (d.cost_usd ?? 0) > 0);
  const total = days.reduce((sum, d) => sum + dayValue(d, metric), 0);
  const busiest = active.reduce<ActivityDay | null>((best, d) => (best === null || dayValue(d, metric) > dayValue(best, metric) ? d : best), null);
  return {
    total,
    days: days.length,
    activeDays: active.length,
    busiest: busiest && dayValue(busiest, metric) > 0 ? busiest : null,
    perActiveDay: active.length ? total / active.length : null,
    books: Math.max(0, ...days.map((d) => d.books)),
  };
}

/** Round axis ticks from 0 to at least `max`: 0, then two or three even steps. */
export function axisTicks(max: number, metric: ActivityMetric): number[] {
  if (max <= 0) return [0];
  const unit = metric === 'compute' ? (max >= 2 * 3_600_000 ? 3_600_000 : 60_000) : 1;
  const scaled = max / unit;
  const rough = scaled / 3;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const ticks = [0];
  for (let t = step; t < scaled + step; t += step) ticks.push(t);
  return ticks.map((t) => (metric === 'cost' ? Math.round(t * 100) / 100 : t * unit));
}

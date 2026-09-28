/** How reader statistics read: time from seconds, counts, shares, dates in the reader's zone. */
import { formatCount, formatDuration, formatPercent, NONE } from '../stats/format';

export { formatCount, formatPercent, NONE };

/** Seconds of attention, in the largest units that matter: `2 h 5 min`, `40 s`. */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return NONE;
  if (seconds > 0 && seconds < 60) return `${Math.round(seconds)} s`;
  return formatDuration(Math.round(seconds / 60) * 60_000);
}

const TIME_STEPS = [60, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 36_000, 72_000, 180_000, 360_000];

/** Round tick values for a time axis up to `max` seconds: whole minutes or hours, about four. */
export function timeTicks(max: number, count = 4): number[] {
  const step = TIME_STEPS.find((s) => max / s <= count) ?? TIME_STEPS[TIME_STEPS.length - 1] ?? 3600;
  return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step);
}

/** For axis ticks: whole minutes, or hours once past two. */
export function formatTick(seconds: number): string {
  if (seconds === 0) return '0';
  if (seconds < 7200) return `${Math.round(seconds / 60)} min`;
  return `${Math.round((seconds / 3600) * 10) / 10} h`;
}

export function formatDate(at: string | null | undefined, tz: string): string {
  if (!at) return NONE;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz });
}

/** `3 days ago`, `today`, from a timestamp and now. */
export function ago(at: string | null | undefined, now: string): string {
  if (!at) return 'never';
  const days = Math.floor((Date.parse(now) - Date.parse(at)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

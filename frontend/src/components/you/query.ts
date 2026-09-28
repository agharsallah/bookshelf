/**
 * The reader statistics a page asks for: its window (`?days=`) and the time zone days are
 * counted in. The page renders on the reader's own machine, so its zone is the reader's.
 */
import { RANGES } from './model';

export interface StatsQuery {
  days: number | null;
  tz: string;
}

export function statsQuery(url: URL, tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'): StatsQuery {
  const raw = url.searchParams.get('days');
  const days = raw === null ? 90 : raw === 'all' ? null : Number(raw);
  const known = RANGES.some((r) => r.days === days);
  return { days: known ? days : 90, tz };
}

/** The link for a window on the same page. */
export function rangeHref(path: string, days: number | null): string {
  return `${path}?days=${days ?? 'all'}`;
}

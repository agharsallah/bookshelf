/**
 * The attention buffer: seconds counted per minute and place, waiting to be reported
 * (`POST /activity`). Pure bookkeeping, no timers or network (`tracker.ts` owns those).
 *
 * Seconds may arrive in fractions (audio time updates); a minute's row never holds more
 * than 60, and a report sends whole seconds, keeping the fraction for the next one.
 */

export type Surface = 'read' | 'listen' | 'study' | 'recall' | 'review' | 'distill' | 'explore';

/** Where attention is going. Every field but `surface` is optional. */
export interface Where {
  surface: Surface;
  /** Document uuid or slug. */
  document?: string;
  /** The chapter anchor. */
  unit?: string;
  /** The block being read. */
  anchor?: string;
  /** What the surface shows: the study kind, `brief`, `episode`, … */
  detail?: string;
}

export interface Entry extends Where {
  /** The minute, ISO 8601. */
  at: string;
  seconds: number;
}

export const MINUTE_MS = 60_000;

interface Bucket {
  where: Where;
  minute: number;
  seconds: number;
}

const keyOf = (where: Where, minute: number) =>
  [minute, where.surface, where.document ?? '', where.unit ?? '', where.anchor ?? '', where.detail ?? ''].join('\u0000');

export class ActivityLog {
  private readonly buckets = new Map<string, Bucket>();

  /** Count `seconds` for `where` in the minute of `now` (ms since the epoch). */
  add(where: Where, seconds: number, now: number): void {
    if (!(seconds > 0)) return;
    const minute = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    const key = keyOf(where, minute);
    const bucket = this.buckets.get(key) ?? { where, minute, seconds: 0 };
    bucket.seconds = Math.min(60, bucket.seconds + seconds);
    this.buckets.set(key, bucket);
  }

  get size(): number {
    return this.buckets.size;
  }

  /**
   * Take every whole second out as entries. The current minute's fraction stays behind;
   * past minutes are rounded and dropped (nothing more will be added to them).
   */
  drain(now: number): Entry[] {
    const current = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    const out: Entry[] = [];
    for (const [key, bucket] of this.buckets) {
      const past = bucket.minute < current;
      const whole = past ? Math.round(bucket.seconds) : Math.floor(bucket.seconds);
      if (whole >= 1) out.push({ ...clean(bucket.where), at: new Date(bucket.minute).toISOString(), seconds: whole });
      bucket.seconds -= whole;
      if (past || bucket.seconds <= 0) this.buckets.delete(key);
    }
    return out;
  }

  /** Put entries that could not be sent back, to go with the next report. */
  restore(entries: readonly Entry[]): void {
    for (const { at, seconds, ...where } of entries) this.add(where, seconds, Date.parse(at));
  }
}

/** Drop empty fields: the API's defaults are the empty string. */
function clean(where: Where): Where {
  return Object.fromEntries(Object.entries(where).filter(([, v]) => v !== undefined && v !== '')) as unknown as Where;
}

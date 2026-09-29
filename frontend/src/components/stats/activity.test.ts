import { describe, expect, it } from 'vitest';
import type { ActivityDay } from '../../lib/api/types/stats';
import { axisTicks, dayParts, emptyDay, fillDays, fittingRange, summarize } from './activity';

const day = (d: string, overrides: Partial<ActivityDay> = {}): ActivityDay => ({ ...emptyDay(d), jobs: 10, compute_ms: 600_000, tokens: 5000, books: 1, ...overrides });

describe('fillDays', () => {
  it('runs a fixed range back from the end, quiet days as zeros', () => {
    const filled = fillDays([day('2026-09-27'), day('2026-09-29')], '2026-09-29', '14');

    expect(filled).toHaveLength(14);
    expect(filled[0]?.day).toBe('2026-09-16');
    expect(filled.at(-1)?.tokens).toBe(5000);
    expect(filled.at(-2)).toEqual(emptyDay('2026-09-28'));
  });

  it('starts all-time at the first active day and crosses month ends', () => {
    const filled = fillDays([day('2026-08-30'), day('2026-09-02')], '2026-09-02', 'all');

    expect(filled.map((d) => d.day)).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02']);
  });

  it('reaches a day recorded after the end it was given', () => {
    expect(fillDays([day('2026-09-30')], '2026-09-29', 'all').map((d) => d.day)).toEqual(['2026-09-30']);
  });
});

describe('dayParts', () => {
  it('splits failed work out of compute and jobs, not out of tokens', () => {
    const d = day('2026-09-01', { jobs: 10, failed: 3, compute_ms: 600_000, failed_ms: 60_000 });

    expect(dayParts(d, 'jobs')).toEqual({ ok: 7, failed: 3 });
    expect(dayParts(d, 'compute')).toEqual({ ok: 540_000, failed: 60_000 });
    expect(dayParts(d, 'tokens')).toEqual({ ok: 5000, failed: 0 });
    expect(dayParts(emptyDay('2026-09-01'), 'cost')).toEqual({ ok: 0, failed: 0 });
  });
});

describe('summarize', () => {
  it('totals the range and finds its busiest day, averaging over active days only', () => {
    const days = fillDays([day('2026-09-27', { tokens: 1000 }), day('2026-09-29', { tokens: 9000, books: 4 })], '2026-09-29', '14');

    const summary = summarize(days, 'tokens');

    expect(summary).toMatchObject({ total: 10_000, days: 14, activeDays: 2, perActiveDay: 5000, books: 4 });
    expect(summary.busiest?.day).toBe('2026-09-29');
  });

  it('has no busiest day and no average when nothing ran', () => {
    expect(summarize([emptyDay('2026-09-01')], 'compute')).toMatchObject({ busiest: null, perActiveDay: null, activeDays: 0 });
  });
});

describe('axisTicks', () => {
  it('steps evenly from zero to past the maximum', () => {
    expect(axisTicks(95, 'jobs')).toEqual([0, 50, 100]);
    expect(axisTicks(1_100_000, 'tokens')).toEqual([0, 500_000, 1_000_000, 1_500_000]);
  });

  it('steps compute time in whole minutes or hours', () => {
    expect(axisTicks(25 * 60_000, 'compute')).toEqual([0, 10, 20, 30].map((m) => m * 60_000));
    expect(axisTicks(5.5 * 3_600_000, 'compute')).toEqual([0, 2, 4, 6].map((h) => h * 3_600_000));
  });

  it('is a lone zero when there is nothing to draw', () => {
    expect(axisTicks(0, 'cost')).toEqual([0]);
  });
});

describe('fittingRange', () => {
  it('picks the shortest range that holds the history, capped at 90 days', () => {
    expect(fittingRange([day('2026-09-24')], '2026-09-29')).toBe('14');
    expect(fittingRange([day('2026-09-10')], '2026-09-29')).toBe('30');
    expect(fittingRange([day('2026-01-01')], '2026-09-29')).toBe('90');
    expect(fittingRange([], '2026-09-29')).toBe('14');
  });
});

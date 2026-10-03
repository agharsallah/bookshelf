import { describe, expect, it } from 'vitest';
import type { Totals } from '../../lib/api/types/readerStats';
import { badgeStatuses, collectionScore, hoursShare, newlyEarned, readSeen, seenLevels, upNext, type BadgeSource } from './badges';

const ZERO: Totals = {
  seconds: 0, reading_seconds: 0, listening_seconds: 0, study_seconds: 0, active_days: 0, sessions: 0,
  mean_session_seconds: null, median_session_seconds: null, longest_session_seconds: null, current_streak: 0,
  longest_streak: 0, books_started: 0, books_finished: 0, chapters_finished: 0, words_read: 0, pages_read: 0,
  words_per_minute: null, notes: 0, highlights: 0, words_written: 0, recalls: 0, predictions: 0, reviews: 0, retention: null,
};

const source = (totals: Partial<Totals> = {}, over: Partial<BadgeSource> = {}): BadgeSource => ({
  totals: { ...ZERO, ...totals },
  hours: [],
  depth: [],
  ...over,
});

const status = (s: BadgeSource, id: string) => {
  const found = badgeStatuses(s).find((b) => b.def.id === id);
  if (!found) throw new Error(`no badge ${id}`);
  return found;
};

describe('tiered badges', () => {
  it('are locked below the first threshold, with progress toward it', () => {
    const streak = status(source({ longest_streak: 2 }), 'streak');
    expect([streak.level, streak.label, streak.next]).toEqual([0, '3 days in a row', '3 days in a row']);
    expect(streak.progress).toBeCloseTo(2 / 3);
  });

  it('climb a level at each threshold and measure the gap to the next', () => {
    const chapters = status(source({ chapters_finished: 30 }), 'chapters');
    expect([chapters.level, chapters.label, chapters.next]).toEqual([3, '25 chapters finished', '50 chapters finished']);
    expect(chapters.progress).toBeCloseTo(5 / 25);
  });

  it('stop at the top level', () => {
    const books = status(source({ books_finished: 400 }), 'books');
    expect([books.level, books.levels, books.next, books.progress]).toEqual([7, 7, null, 1]);
  });

  it('add notes and highlights together, and count hours from seconds', () => {
    expect(status(source({ notes: 20, highlights: 5 }), 'marginalia').level).toBe(2);
    expect(status(source({ seconds: 10 * 3600 }), 'time').label).toBe('10 hours with books');
  });
});

describe('single badges', () => {
  it('are earned once their goal is met', () => {
    expect(status(source({ longest_session_seconds: 1800 }), 'marathon')).toMatchObject({ level: 0, progress: 0.5 });
    expect(status(source({ longest_session_seconds: 4000 }), 'marathon')).toMatchObject({ level: 1, next: null, progress: 1 });
  });

  it('need both many reviews and high retention for a good memory', () => {
    expect(status(source({ reviews: 10, retention: 1 }), 'memory').level).toBe(0);
    expect(status(source({ reviews: 60, retention: 0.8 }), 'memory').level).toBe(0);
    expect(status(source({ reviews: 60, retention: 0.92 }), 'memory').level).toBe(1);
  });

  it('go all the way down only with a reviewed book', () => {
    const depth = (reviewed: number) => source({}, { depth: [{ depth: 'opened', books: 2 }, { depth: 'read', books: 2 }, { depth: 'annotated', books: 1 }, { depth: 'recalled', books: 1 }, { depth: 'reviewed', books: reviewed }] });
    expect(status(depth(0), 'deep').level).toBe(0);
    expect(status(depth(1), 'deep').level).toBe(1);
  });

  it('read the hours of the day for the night owl, after enough time', () => {
    const late = [{ weekday: 0, hour: 23, seconds: 4 * 3600 }, { weekday: 0, hour: 14, seconds: 2 * 3600 }];
    expect(status(source({ seconds: 6 * 3600 }, { hours: late }), 'owl').level).toBe(1);
    expect(status(source({ seconds: 6 * 3600 }, { hours: late }), 'lark').level).toBe(0);
    expect(status(source({ seconds: 3600 }, { hours: late }), 'owl').level).toBe(0);
  });
});

describe('hoursShare', () => {
  it('wraps a window across midnight', () => {
    const cells = [{ weekday: 0, hour: 23, seconds: 10 }, { weekday: 1, hour: 2, seconds: 10 }, { weekday: 1, hour: 12, seconds: 20 }];
    expect(hoursShare(cells, 22, 4)).toBe(0.5);
    expect(hoursShare(cells, 10, 14)).toBe(0.5);
    expect(hoursShare([], 22, 4)).toBe(0);
  });
});

describe('the collection', () => {
  it('lists the nearest next levels first, leaving maxed badges out', () => {
    // Streak 6 of 3→7 is 75% of the way; 2 recalls of 1→5 is 25%; 400 books is the top.
    const next = upNext(badgeStatuses(source({ longest_streak: 6, recalls: 2, books_finished: 400 })), 2);
    expect(next.map((b) => b.def.id)).toEqual(['streak', 'recalls']);
  });

  it('scores levels earned of all there are', () => {
    const { earned, total } = collectionScore(badgeStatuses(source({ books_finished: 3, longest_session_seconds: 3600 })));
    expect(earned).toBe(3);
    expect(total).toBeGreaterThan(earned);
  });
});

describe('newly earned', () => {
  it('treats the first look as the baseline, then reports levels gained since', () => {
    const before = badgeStatuses(source({ chapters_finished: 9 }));
    const after = badgeStatuses(source({ chapters_finished: 10 }));
    expect(newlyEarned(after, null)).toEqual([]);
    expect(newlyEarned(after, seenLevels(before)).map((b) => b.def.id)).toEqual(['chapters']);
    expect(newlyEarned(after, seenLevels(after))).toEqual([]);
  });

  it('reads nothing from broken storage', () => {
    expect(readSeen({ getItem: () => 'not json' })).toBeNull();
    expect(readSeen({ getItem: () => '[1]' })).toBeNull();
    expect(readSeen({ getItem: () => '{"books":2}' })).toEqual({ books: 2 });
  });
});

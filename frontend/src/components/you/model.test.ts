import { describe, expect, it } from 'vitest';
import type { ChapterRow, DayPoint, Session } from '../../lib/api/types/readerStats';
import { addDays, bookColors, countColumns, localDay, localHour, mainSurface, sittings, surfacesIn, timeColumns, treemapGroups, viewRange, weekOf } from './model';
import { formatTick, formatTime, timeTicks } from './format';

const day = (date: string, seconds: DayPoint['seconds'], notes = 0): DayPoint => ({ date, seconds, notes, reviews: 0, recalls: 0, moves: 0 });

describe('dates', () => {
  it('reads a timestamp as a local day and hour', () => {
    expect(localDay('2026-09-28T22:30:00Z', 'Europe/Berlin')).toBe('2026-09-29');
    expect(localHour('2026-09-28T22:30:00Z', 'Europe/Berlin', '2026-09-29')).toBe(0.5);
    expect(localHour('2026-09-29T00:30:00Z', 'UTC', '2026-09-28')).toBe(24.5);
  });

  it('starts weeks on Monday', () => {
    expect(weekOf('2026-09-27')).toBe('2026-09-21'); // a Sunday
    expect(weekOf('2026-09-28')).toBe('2026-09-28');
  });

  it('covers the window, or everything since the first day', () => {
    const base = { generated_at: '2026-09-28T10:00:00Z', tz: 'UTC', daily: [day('2026-09-01', {})] };
    expect(viewRange({ ...base, days: 7 })).toEqual({ from: '2026-09-22', to: '2026-09-28' });
    expect(viewRange({ ...base, days: null })).toEqual({ from: '2026-09-01', to: '2026-09-28' });
  });
});

describe('timeColumns', () => {
  it('keeps empty days and adds up surfaces per day', () => {
    const columns = timeColumns([day('2026-09-02', { read: 60, listen: 30 })], '2026-09-01', '2026-09-03');

    expect(columns.map((c) => [c.key, c.values])).toEqual([
      ['2026-09-01', {}],
      ['2026-09-02', { read: 60, listen: 30 }],
      ['2026-09-03', {}],
    ]);
  });

  it('goes weekly over a long range', () => {
    const columns = timeColumns([day('2026-09-02', { read: 60 }), day('2026-09-04', { read: 30 })], '2026-06-01', '2026-09-06');

    expect(columns.at(-1)).toMatchObject({ key: '2026-08-31', values: { read: 90 } });
    expect(columns[0]?.key).toBe('2026-06-01');
  });

  it('counts actions per day as a single series', () => {
    const columns = countColumns([day('2026-09-02', {}, 3)], 'notes', '2026-09-01', '2026-09-02');

    expect(columns.map((c) => c.values)).toEqual([{ notes: 0 }, { notes: 3 }]);
  });
});

describe('surfaces and colors', () => {
  it('lists the surfaces with time in their fixed order', () => {
    expect(surfacesIn({ listen: 5 }, { read: 1 }).map((s) => s.key)).toEqual(['read', 'listen']);
  });

  it('gives the first books their own color and the rest one', () => {
    const colors = bookColors(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(colors.a).toBe('var(--series-1)');
    expect(colors.g).toBe('var(--series-other)');
  });

  it('names the surface a session was mostly on', () => {
    expect(mainSurface({ read: 60, listen: 600 })).toBe('listen');
  });
});

describe('sittings', () => {
  const session = (start: string, end: string): Session => ({ start, end, seconds: 1800, surfaces: { read: 1800 }, documents: ['book'] });

  it('places sessions on their local day and hours, newest day first', () => {
    const { days, sittings: found } = sittings([session('2026-09-28T07:00:00Z', '2026-09-28T07:30:00Z')], 'UTC', '2026-09-28', 3, formatTime, { book: 'The Book' });

    expect(days).toEqual(['2026-09-28', '2026-09-27', '2026-09-26']);
    expect(found[0]).toMatchObject({ day: '2026-09-28', from: 7, to: 7.5, series: 'read' });
    expect(found[0]?.rows.at(-1)).toEqual({ label: 'book', value: 'The Book' });
  });

  it('leaves out sessions before the window', () => {
    const { sittings: found } = sittings([session('2026-09-20T07:00:00Z', '2026-09-20T07:30:00Z')], 'UTC', '2026-09-28', 3, formatTime, {});

    expect(found).toEqual([]);
  });
});

describe('treemapGroups', () => {
  const chapter = (document: string, anchor: string, read: number): ChapterRow => ({
    document, book_title: document.toUpperCase(), anchor, title: anchor, position: 0, words: 1000, pages: 10, progress: 1,
    read_seconds: read, listen_seconds: 0, other_seconds: 0, visits: 1, notes: 0, highlights: 0, recall_score: null,
    words_per_minute: null, pace: null, last_seen: null,
  });

  it('groups chapters by book, most time first, and drops chapters without time', () => {
    const groups = treemapGroups([chapter('a', 'ch01', 60), chapter('b', 'ch01', 600), chapter('a', 'ch02', 0)], bookColors(['a', 'b']));

    expect(groups.map((g) => [g.key, g.leaves.map((l) => l.key)])).toEqual([
      ['b', ['ch01']],
      ['a', ['ch01']],
    ]);
    expect(groups[0]?.leaves[0]?.href).toBe('/documents/b/read/ch01');
  });
});

describe('format', () => {
  it('reads seconds of attention', () => {
    expect(formatTime(42)).toBe('42 s');
    expect(formatTime(3 * 3600 + 5 * 60)).toBe('3 h 5 min');
    expect(formatTick(5400)).toBe('90 min');
    expect(formatTick(3 * 3600)).toBe('3 h');
    expect(addDays('2026-09-28', 3)).toBe('2026-10-01');
  });
});

describe('timeTicks', () => {
  it('steps in round minutes or hours', () => {
    expect(timeTicks(5000)).toEqual([0, 1800, 3600]);
    expect(timeTicks(24_800)).toEqual([0, 7200, 14_400, 21_600]);
    expect(timeTicks(200)).toEqual([0, 60, 120, 180]);
  });
});

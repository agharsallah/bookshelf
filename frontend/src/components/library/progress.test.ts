import { describe, expect, it } from 'vitest';
import type { ReadingPosition } from '../../lib/api/types/documents';
import { currentBook, mapLimit, NOT_READ, readingLabel, shelfReading, withFinished } from './progress';

const at = (unit: string, progress: number, updated_at: string): ReadingPosition => ({ unit, anchor: `${unit}/p001`, progress, updated_at });

describe('shelfReading', () => {
  it('counts each chapter the same, a finished one whole, and keeps the latest time', () => {
    const reading = shelfReading([at('ch01', 0.98, '2026-09-20T00:00:00Z'), at('ch02', 0.5, '2026-09-22T00:00:00Z')], 4);
    expect(reading.share).toBeCloseTo(1.5 / 4);
    expect(reading.lastRead).toBe('2026-09-22T00:00:00Z');
    expect(reading.resume).toBe('ch02/p001');
  });

  it('has nothing to resume when the chapter read last is finished', () => {
    expect(shelfReading([at('ch01', 0.5, '2026-09-20T00:00:00Z'), at('ch02', 1, '2026-09-22T00:00:00Z')], 4).resume).toBeNull();
  });

  it('is unread without positions and never above the whole book', () => {
    expect(shelfReading([], 10)).toEqual(NOT_READ);
    expect(shelfReading([at('a', 1, 't'), at('b', 1, 't')], 1).share).toBe(1);
  });
});

describe('withFinished', () => {
  it('reads a marked document as finished, keeping when it was last read', () => {
    const partway = shelfReading([at('ch01', 0.5, '2026-09-20T00:00:00Z')], 4);
    const marked = withFinished(partway, '2026-10-01T00:00:00Z');
    expect(marked).toEqual({ share: 1, lastRead: '2026-09-20T00:00:00Z', resume: null });
    expect(readingLabel(marked)).toBe('Finished');
    expect(withFinished(NOT_READ, '2026-10-01T00:00:00Z').lastRead).toBe('2026-10-01T00:00:00Z');
    expect(withFinished(partway, null)).toBe(partway);
  });
});

describe('currentBook', () => {
  it('is the book read most recently, or none', () => {
    expect(currentBook({ a: { share: 0.1, lastRead: '2026-09-01', resume: null }, b: { share: 0.1, lastRead: '2026-09-05', resume: null }, c: NOT_READ })).toBe('b');
    expect(currentBook({ c: NOT_READ })).toBeNull();
  });
});

describe('readingLabel', () => {
  it('says how far, in the reader’s words', () => {
    expect(readingLabel(NOT_READ)).toBe('Not started');
    expect(readingLabel({ share: 0.001, lastRead: 't', resume: null })).toBe('1% read');
    expect(readingLabel({ share: 0.42, lastRead: 't', resume: null })).toBe('42% read');
    expect(readingLabel({ share: 1, lastRead: 't', resume: null })).toBe('Finished');
  });
});

describe('mapLimit', () => {
  it('keeps the input order and never runs more than the limit at once', async () => {
    let running = 0;
    let most = 0;
    const results = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, n));
      running -= 1;
      return n * 10;
    });
    expect(results).toEqual([50, 10, 40, 20, 30]);
    expect(most).toBe(2);
  });

  it('handles nothing to do', async () => {
    expect(await mapLimit([], 3, async (n: number) => n)).toEqual([]);
  });
});

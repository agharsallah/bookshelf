import { describe, expect, it } from 'vitest';
import type { ReadingPosition, TreeNode } from '../api/types/documents';
import { bookProgress, continueTarget, percent, positionsByUnit } from './reading';

const unit = (anchor: string, pages: [number, number] | null = null, meta: Partial<TreeNode['meta']> = {}): TreeNode =>
  ({
    anchor,
    kind: 'chapter',
    heading: anchor,
    page_from: pages?.[0] ?? null,
    page_to: pages?.[1] ?? null,
    meta,
    children: [],
  }) as unknown as TreeNode;

let clock = 0;
const at = (unit: string, anchor: string, progress: number): ReadingPosition => ({
  unit,
  anchor,
  progress,
  updated_at: new Date(Date.UTC(2026, 8, 26, 12, 0, clock++)).toISOString(),
});

const units = [unit('ch00', [1, 4], { front_matter: true }), unit('ch01', [5, 14]), unit('ch02', [15, 44]), unit('ch03', [45, 54])];

describe('percent', () => {
  it('never shows 100 before the chapter is finished', () => {
    expect([percent(0), percent(0.424), percent(0.96), percent(0.97), percent(1)]).toEqual([0, 42, 96, 100, 100]);
  });
});

describe('positionsByUnit', () => {
  it('drops positions of chapters that no longer exist', () => {
    const kept = positionsByUnit([at('ch01', 'ch01/p001', 0.2), at('ch09', 'ch09/p001', 0.5)], units);
    expect(Object.keys(kept)).toEqual(['ch01']);
  });
});

describe('continueTarget', () => {
  it('is null before anything is read', () => {
    expect(continueTarget([], units)).toBeNull();
  });

  it('picks up at the block last read in the chapter read most recently', () => {
    const target = continueTarget([at('ch02', 'ch02/p010', 0.3), at('ch01', 'ch01/s02/p004', 0.6)], units);
    expect(target).toMatchObject({ anchor: 'ch01/s02/p004', progress: 0.6, kind: 'continue' });
    expect(target?.unit.anchor).toBe('ch01');
  });

  it('moves on to the next unfinished chapter once the last one is finished', () => {
    const target = continueTarget([at('ch02', 'ch02/p003', 0.1), at('ch01', 'ch01/p099', 1)], units);
    expect(target).toMatchObject({ anchor: 'ch02/p003', progress: 0.1, kind: 'next' });
  });

  it('skips finished chapters and starts a fresh one at its top', () => {
    const target = continueTarget([at('ch02', 'ch02/p099', 1), at('ch01', 'ch01/p099', 1)], units);
    expect(target).toMatchObject({ anchor: 'ch03', progress: 0, kind: 'next' });
  });

  it('is null when the book is finished', () => {
    expect(continueTarget([at('ch01', 'a', 1), at('ch02', 'b', 1), at('ch03', 'c', 1)], units)).toBeNull();
  });
});

describe('bookProgress', () => {
  it('weights chapters by their pages and leaves unread front matter out', () => {
    // ch01 (10 pages) finished, ch02 (30 pages) half read, ch03 (10 pages) untouched.
    const result = bookProgress([at('ch01', 'x', 0.98), at('ch02', 'y', 0.5)], units);
    expect(result.progress).toBeCloseTo((10 + 15) / 50);
    expect(result).toMatchObject({ finished: 1, total: 3 });
  });

  it('counts front matter once you have read some of it', () => {
    expect(bookProgress([at('ch00', 'z', 0.5)], units).total).toBe(4);
  });

  it('gives chapters without pages equal weight', () => {
    const plain = [unit('p001'), unit('p002')];
    expect(bookProgress([at('p001', 'p001', 1)], plain).progress).toBe(0.5);
  });
});

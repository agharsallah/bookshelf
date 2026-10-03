import { describe, expect, it } from 'vitest';
import { finishesBook } from './useChapterCheer';

describe('finishesBook', () => {
  const units = [{ anchor: 'pre' }, { anchor: 'ch01' }, { anchor: 'ch02' }, { anchor: 'ch03' }];

  it('is true for the last unfinished unit', () => {
    expect(finishesBook(units, new Set(['pre', 'ch01', 'ch02']), 'ch03')).toBe(true);
  });

  it('is false while another unit is unfinished', () => {
    expect(finishesBook(units, new Set(['pre', 'ch01']), 'ch03')).toBe(false);
  });
});

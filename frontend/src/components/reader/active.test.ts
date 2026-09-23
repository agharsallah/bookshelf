import { describe, expect, it } from 'vitest';
import { pickActive } from './active';

const box = (anchor: string, top: number, bottom: number) => ({ anchor, top, bottom });

describe('pickActive', () => {
  it('picks the block crossing the reading line', () => {
    expect(pickActive([box('p1', -200, 50), box('p2', 60, 300), box('p3', 310, 500)], 200)).toBe('p2');
  });

  it('falls back to the last block above the line when the line is in a gap', () => {
    expect(pickActive([box('p2', 150, 190), box('p1', 0, 140), box('p3', 260, 400)], 200)).toBe('p2');
  });

  it('picks the first block when every block is below the line', () => {
    expect(pickActive([box('p2', 600, 700), box('p1', 400, 500)], 200)).toBe('p1');
  });

  it('is null with nothing in view', () => {
    expect(pickActive([], 200)).toBeNull();
  });

  it('a block ending exactly on the line no longer counts as crossing it', () => {
    expect(pickActive([box('p1', 0, 200), box('p2', 200, 400)], 200)).toBe('p2');
  });
});

import { describe, expect, it } from 'vitest';
import { overlaps, placeLabels, shorten, type LabelCandidate } from './labels';

const view = { width: 400, height: 300 };
const label = (id: string, x: number, y: number, priority: number, width = 60): LabelCandidate => ({ id, x, y, r: 6, width, height: 14, priority });

describe('placeLabels', () => {
  it('sets a lone label to the right of its node', () => {
    expect(placeLabels([label('a', 100, 100, 1)], view)).toEqual([{ id: 'a', x: 111, y: 93, width: 60, height: 14, side: 'right' }]);
  });

  it('moves a label to another side rather than overlap a higher-priority one', () => {
    const placed = placeLabels([label('low', 100, 104, 1), label('high', 100, 100, 5)], view);
    expect(placed.map((p) => [p.id, p.side])).toEqual([
      ['high', 'right'],
      ['low', 'left'],
    ]);
  });

  it('never returns overlapping labels, and drops what cannot fit', () => {
    const crowd = Array.from({ length: 12 }, (_, i) => label(`n${i}`, 200, 150 + (i % 2), 12 - i, 120));
    const placed = placeLabels(crowd, view);
    const pairs = placed.flatMap((a, i) => placed.slice(i + 1).map((b) => overlaps(a, b)));
    expect(pairs.every((o) => !o)).toBe(true);
    expect(placed.length).toBeLessThan(crowd.length);
    expect(placed[0]?.id).toBe('n0');
  });

  it('keeps labels off other nodes’ marks and inside the viewport', () => {
    const placed = placeLabels([label('edge', 370, 150, 1), { ...label('blocker', 340, 150, 0), width: 1 }], view);
    expect(placed.find((p) => p.id === 'edge')?.side).toBe('below');
  });
});

describe('shorten', () => {
  it('cuts long labels on a word boundary with an ellipsis', () => {
    expect([shorten('Stocks and flows', 34), shorten('The limits to growth and the tragedy of the commons', 24)]).toEqual([
      'Stocks and flows',
      'The limits to growth…',
    ]);
  });
});

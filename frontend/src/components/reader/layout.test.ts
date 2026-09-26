import { describe, expect, it } from 'vitest';
import { canDragMeasure, clampMeasure, dragMeasure, isCentred, MIN_MEASURE, readerLayout } from './layout';

const base = { rail: true, pane: true, focus: false, wide: true, narrow: false };

describe('readerLayout', () => {
  it('counts the panes actually on screen: the rail only where it fits', () => {
    expect(readerLayout(base)).toBe('both');
    expect(readerLayout({ ...base, rail: false })).toBe('one');
    expect(readerLayout({ ...base, pane: false })).toBe('one');
    expect(readerLayout({ ...base, wide: false })).toBe('one');
    expect(readerLayout({ ...base, rail: false, pane: false })).toBe('fill');
    expect(readerLayout({ ...base, wide: false, pane: false })).toBe('fill');
  });

  it('lets focus mode and phones win over the pane settings', () => {
    expect(readerLayout({ ...base, focus: true, rail: false, pane: false })).toBe('focus');
    expect(readerLayout({ ...base, narrow: true, focus: true })).toBe('stack');
  });
});

describe('canDragMeasure / isCentred', () => {
  it('drags the width while any side pane is shown, never in fill, focus or on phones', () => {
    expect((['both', 'one', 'fill', 'focus', 'stack'] as const).map(canDragMeasure)).toEqual([true, true, false, false, false]);
  });

  it('centres the column only when the rail is its one neighbour', () => {
    expect([isCentred('one', false), isCentred('one', true), isCentred('both', true)]).toEqual([true, false, false]);
  });
});

describe('dragMeasure', () => {
  it('puts the edge of an anchored column under the pointer', () => {
    expect(dragMeasure(900, 200, 'start')).toBe(700);
  });

  it('widens a column pinned at its end as the pointer moves left, away from that end', () => {
    expect(dragMeasure(480, 1280, 'end')).toBe(800);
  });

  it('grows a centred column twice as fast as the pointer moves, since both edges move', () => {
    expect(dragMeasure(1100, 800, 'centre')).toBe(600);
  });

  it('never goes below the narrowest readable column', () => {
    expect(dragMeasure(210, 200, 'start')).toBe(MIN_MEASURE);
    expect(dragMeasure(1100, 1280, 'end')).toBe(MIN_MEASURE);
    expect(clampMeasure(612.4)).toBe(612);
  });
});

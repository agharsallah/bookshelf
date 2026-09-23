import { describe, expect, it } from 'vitest';
import { barPath, linePath } from './paths';

describe('linePath', () => {
  it('draws a polyline and breaks it at gaps', () => {
    expect(linePath([{ x: 0, y: 10 }, { x: 5, y: 20 }, null, { x: 15, y: 5 }, { x: 20, y: 0 }])).toBe(
      'M0,10L5,20M15,5L20,0',
    );
  });

  it('is empty when there is nothing to draw', () => {
    expect(linePath([null, null])).toBe('');
  });
});

describe('barPath', () => {
  it('rounds the data end and keeps the baseline square for positive values', () => {
    expect(barPath(10, 20, 100, 40, 4)).toBe('M10,100V44Q10,40 14,40H26Q30,40 30,44V100Z');
  });

  it('grows downward and rounds the bottom for negative values', () => {
    expect(barPath(10, 20, 100, 140, 4)).toBe('M10,100V136Q10,140 14,140H26Q30,140 30,136V100Z');
  });

  it('never rounds more than the bar is tall', () => {
    expect(barPath(0, 20, 100, 98, 4)).toBe('M0,100V100Q0,98 2,98H18Q20,98 20,100V100Z');
  });
});

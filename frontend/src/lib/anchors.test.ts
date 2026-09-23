import { describe, expect, it } from 'vitest';
import { anchorLabel, defaultCiteHref } from './anchors';

describe('anchorLabel', () => {
  it.each([
    ['ch03/s02/p014', '3.2 ¶14'],
    ['ch06/p003', '6 ¶3'],
    ['p007', '¶7'],
    ['ch03/s02', '3.2'],
    ['part1/ch10', '1.10'],
  ])('labels %s as %s', (anchor, label) => {
    expect(anchorLabel(anchor)).toBe(label);
  });
});

describe('defaultCiteHref', () => {
  it('points at the in-page fragment', () => {
    expect(defaultCiteHref('ch01/s02/p003')).toBe('#ch01/s02/p003');
  });
});

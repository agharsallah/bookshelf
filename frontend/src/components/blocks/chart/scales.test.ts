import { describe, expect, it } from 'vitest';
import { bandScale, linearScale, nearestIndex, niceDomain, niceStep, pointScale, valueExtent } from './scales';

describe('niceStep', () => {
  it.each([
    [100, 5, 20],
    [10, 5, 2],
    [25, 5, 5],
    [7, 5, 2],
    [3.6, 5, 1],
    [0.9, 5, 0.2],
    [4000, 4, 1000],
  ])('span %d over %d ticks steps by %d', (span, count, step) => {
    expect(niceStep(span, count)).toBe(step);
  });
});

describe('niceDomain', () => {
  it('extends outward to whole steps', () => {
    expect(niceDomain(20, 61, 5)).toEqual({ domain: [20, 70], ticks: [20, 30, 40, 50, 60, 70] });
  });

  it('keeps float ticks clean', () => {
    expect(niceDomain(0, 0.9, 5).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it('pads a flat domain so it has height', () => {
    expect(niceDomain(0, 0, 5).domain).toEqual([0, 1]);
  });
});

describe('linearScale', () => {
  it('maps the domain onto an inverted pixel range', () => {
    const y = linearScale([0, 100], [250, 50]);
    expect([y(0), y(50), y(100)]).toEqual([250, 150, 50]);
  });
});

describe('bandScale', () => {
  it('divides the range into equal bands with padding', () => {
    const band = bandScale(4, [0, 100], 0.2, 0);
    expect(band.step).toBeCloseTo(100 / 3.8);
    expect(band.bandwidth).toBeCloseTo(band.step * 0.8);
    expect(band.start(3) + band.bandwidth).toBeCloseTo(100);
    expect(band.center(0)).toBeCloseTo(band.bandwidth / 2);
  });
});

describe('pointScale', () => {
  it('centres points in equal slots', () => {
    const x = pointScale(4, [0, 400]);
    expect([x(0), x(3)]).toEqual([50, 350]);
  });
});

describe('valueExtent', () => {
  it('ignores nulls and can force zero into the extent', () => {
    const series = [{ values: [3, null, 9] }, { values: [5, -2] }];
    expect(valueExtent(series, false)).toEqual([-2, 9]);
    expect(valueExtent([{ values: [3, 9] }], true)).toEqual([0, 9]);
  });

  it('defaults to [0, 1] when every value is missing', () => {
    expect(valueExtent([{ values: [null, null] }], false)).toEqual([0, 1]);
  });
});

describe('nearestIndex', () => {
  it('snaps to the closest position', () => {
    expect(nearestIndex([10, 50, 90], 68)).toBe(1);
    expect(nearestIndex([10, 50, 90], 71)).toBe(2);
  });
});

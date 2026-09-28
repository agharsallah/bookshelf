import { describe, expect, it } from 'vitest';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd, NONE } from './format';

describe('formatDuration', () => {
  it.each([
    [450, '450 ms'],
    [4_200, '4.2 s'],
    [42_000, '42 s'],
    [60_000, '1 min'],
    [95_000, '1 min 35 s'],
    [3_600_000, '1 h'],
    [6_044_359, '1 h 40 min'],
    [318_216_979, '3 d 16 h'],
  ])('%d ms reads as %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });

  it('shows a missing duration as a dash, not zero', () => {
    expect(formatDuration(null)).toBe(NONE);
  });
});

describe('formatCount', () => {
  it.each([
    [980, '980'],
    [9_999, '9,999'],
    [12_345, '12.3k'],
    [275_069, '275k'],
    [1_242_375, '1.2M'],
    [12_000_000, '12M'],
  ])('%d reads as %s', (n, text) => {
    expect(formatCount(n)).toBe(text);
  });
});

describe('shares, money and plain numbers', () => {
  it('formats each with its own precision', () => {
    expect(formatPercent(0.236)).toBe('24%');
    expect(formatPercent(0.9567, 1)).toBe('95.7%');
    expect(formatUsd(0.038816)).toBe('$0.04');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatNumber(1.67)).toBe('1.7');
    expect(formatNumber(2.0)).toBe('2');
    expect(formatPercent(null)).toBe(NONE);
  });
});

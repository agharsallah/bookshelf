import { describe, expect, it } from 'vitest';
import { rangeHref, statsQuery } from './query';

describe('statsQuery', () => {
  it('defaults to the last 90 days, and takes a known window or all time', () => {
    const at = (qs: string) => statsQuery(new URL(`http://x/you${qs}`), 'Europe/Berlin');

    expect(at('')).toEqual({ days: 90, tz: 'Europe/Berlin' });
    expect(at('?days=7').days).toBe(7);
    expect(at('?days=all').days).toBeNull();
    expect(at('?days=13').days).toBe(90);
  });

  it('links a window on the same page', () => {
    expect(rangeHref('/you/book', null)).toBe('/you/book?days=all');
  });
});

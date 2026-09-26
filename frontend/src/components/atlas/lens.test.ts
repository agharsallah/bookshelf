import { describe, expect, it } from 'vitest';
import { cleared, DEFAULT_LENS, isFiltering, lensFromParams, lensToParams, toggle } from './lens';

describe('lens URL', () => {
  it('round-trips a lens through the query string', () => {
    const lens = {
      ...DEFAULT_LENS,
      mode: 'lens' as const,
      links: ['supports' as const, 'shares' as const],
      kinds: ['framework' as const],
      books: ['00000000-0000-4000-8000-00000000000f'],
      crossBook: true,
      others: 'hide' as const,
      group: 'book' as const,
      query: 'loop',
      selected: 'concept:law',
    };
    expect(lensFromParams(lensToParams(lens))).toEqual(lens);
  });

  it('keeps the default map out of the URL entirely', () => {
    expect(lensToParams(DEFAULT_LENS).toString()).toBe('');
  });

  it('drops values it does not know instead of trusting them', () => {
    const lens = lensFromParams(new URLSearchParams('mode=weird&links=supports,nonsense&kinds=alien&books=not-a-uuid&others=explode'));
    expect(lens).toMatchObject({
      mode: 'map',
      links: ['supports'],
      kinds: [],
      books: [],
      others: 'dim',
    });
  });
});

describe('toggle', () => {
  const all = ['a', 'b', 'c'] as const;
  it('turns one value off from "all", and back to "all" once every value is on', () => {
    const off = toggle<'a' | 'b' | 'c'>(null, 'b', all);
    expect(off).toEqual(['a', 'c']);
    expect(toggle(off, 'b', all)).toBeNull();
  });
});

describe('isFiltering and cleared', () => {
  it('counts only lens-mode filters, and clearing keeps mode, layout and selection', () => {
    const lens = {
      ...DEFAULT_LENS,
      mode: 'lens' as const,
      crossBook: true,
      group: 'book' as const,
      selected: 'concept:x',
      query: 'q',
    };
    expect(isFiltering(lens)).toBe(true);
    expect(isFiltering({ ...lens, mode: 'map' })).toBe(false);
    expect(cleared(lens)).toEqual({
      ...DEFAULT_LENS,
      mode: 'lens',
      group: 'book',
      selected: 'concept:x',
    });
  });
});

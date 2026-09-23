import { describe, expect, it } from 'vitest';
import { parseSearchParams, searchHref, toSearchParams, toSearchRequest, type SearchState } from './url-state';

const full: SearchState = {
  q: 'stock and flow',
  mode: 'lexical',
  documents: ['d1', 'd2'],
  tags: ['systems'],
  types: ['chapter_distillation'],
};

describe('search URL state', () => {
  it('round-trips through the query string', () => {
    expect(parseSearchParams(new URLSearchParams(toSearchParams(full)))).toEqual(full);
  });

  it('leaves defaults out of the URL', () => {
    expect(toSearchParams({ ...full, mode: 'auto', documents: [], tags: [], types: [] })).toBe('q=stock+and+flow');
    expect(searchHref({ q: '  ' })).toBe('/search');
  });

  it('drops unknown modes and artifact types and de-duplicates repeats', () => {
    const state = parseSearchParams(new URLSearchParams('q=x&mode=psychic&type=faq&type=bogus&tag=a&tag=a&doc='));
    expect(state).toEqual({ q: 'x', mode: 'auto', documents: [], tags: ['a'], types: ['faq'] });
  });

  it('builds the request body with only the filters in use', () => {
    expect(toSearchRequest({ ...full, q: '  loops ', documents: [], types: [] }, 5)).toEqual({
      query: 'loops',
      mode: 'lexical',
      filters: { tags: ['systems'] },
      limit: 5,
    });
  });

  it('has nothing to send for a blank query', () => {
    expect(toSearchRequest({ ...full, q: '   ' })).toBeNull();
  });
});

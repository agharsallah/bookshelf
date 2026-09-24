import { describe, expect, it } from 'vitest';
import { parseSearchParams, searchHref, toSearchParams, toSearchRequest, type SearchState } from './url-state';

const full: SearchState = {
  q: 'stock and flow',
  mode: 'lexical',
  documents: ['7c9e6679-7425-40de-944b-e07fc1f90ae7', 'ef282f5b-5420-405a-94da-70c5fc1f59e9'],
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

  // The backend answers 422 for the whole search when a document id is not a UUID or a
  // tag is over 64 characters, so a hand-edited or stale URL must not carry them through.
  it('drops document ids that are not UUIDs and tags the backend would refuse', () => {
    const long = 'x'.repeat(65);
    const state = parseSearchParams(new URLSearchParams(`q=x&doc=thinking-in-systems&doc=EF282F5B-5420-405A-94DA-70C5FC1F59E9&tag=${long}&tag=ok`));
    expect([state.documents, state.tags]).toEqual([['EF282F5B-5420-405A-94DA-70C5FC1F59E9'], ['ok']]);
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

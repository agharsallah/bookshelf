import { describe, expect, it } from 'vitest';
import { documentsQuery, filterHref, hasFilters, parseFilters, tagCloud } from './filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('parseFilters', () => {
  it('reads every filter, trimmed', () => {
    expect(parse('tag=systems&status=parsed&author=%20Meadows%20&q=loops')).toEqual({
      tag: 'systems',
      status: 'parsed',
      author: 'Meadows',
      q: 'loops',
    });
  });

  it('drops blanks and unknown statuses', () => {
    expect(parse('tag=&status=shelved&author=%20%20')).toEqual({ tag: null, status: null, author: null, q: null });
  });

  it('caps overlong values at the API’s limits', () => {
    expect(parse(`tag=${'x'.repeat(100)}`).tag).toHaveLength(64);
  });
});

describe('documentsQuery', () => {
  it('sends only the filters that are set, plus the page size', () => {
    expect(documentsQuery({ tag: 'systems', status: null, author: null, q: 'flow' })).toEqual({
      limit: 100,
      tag: 'systems',
      q: 'flow',
    });
  });
});

describe('filterHref', () => {
  const current = { tag: 'systems', status: 'parsed', author: null, q: null } as const;

  it('changes one filter and keeps the rest', () => {
    expect(filterHref(current, { tag: 'queues' })).toBe('/library?tag=queues&status=parsed');
  });

  it('clears a filter with null, and the whole query when nothing is left', () => {
    expect(filterHref(current, { status: null })).toBe('/library?tag=systems');
    expect(filterHref(current, { tag: null, status: null })).toBe('/library');
  });

  it('encodes values', () => {
    expect(filterHref({ tag: null, status: null, author: null, q: null }, { q: 'a&b c' })).toBe('/library?q=a%26b+c');
  });
});

describe('hasFilters', () => {
  it('is true when any filter is set', () => {
    expect(hasFilters(parse(''))).toBe(false);
    expect(hasFilters(parse('author=Reinertsen'))).toBe(true);
  });
});

describe('tagCloud', () => {
  it('counts tags, most used first, ties alphabetical', () => {
    expect(tagCloud([{ tags: ['b', 'a'] }, { tags: ['a'] }, { tags: ['c'] }])).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 1 },
      { tag: 'c', count: 1 },
    ]);
  });
});

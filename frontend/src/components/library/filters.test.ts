import { describe, expect, it } from 'vitest';
import {
  documentsQuery,
  filterHref,
  hasFilters,
  libraryHref,
  matchesFilters,
  noMatchMessage,
  parseFilters,
  resultSummary,
  tagCloud,
  type LibraryFilters,
} from './filters';

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

const none: LibraryFilters = { tag: null, status: null, author: null, q: null };

describe('matchesFilters', () => {
  const book = { title: 'Thinking in Systems', authors: ['Donella Meadows'], tags: ['systems'], status: 'linked' };

  it('passes every book when nothing is set', () => {
    expect(matchesFilters(book, none)).toBe(true);
  });

  it('matches words in the title and the authors, ignoring case', () => {
    expect(matchesFilters(book, { ...none, q: 'in sys' })).toBe(true);
    expect(matchesFilters(book, { ...none, q: 'flow' })).toBe(false);
    expect(matchesFilters(book, { ...none, author: 'meadows' })).toBe(true);
    expect(matchesFilters(book, { ...none, author: 'Reinertsen' })).toBe(false);
  });

  it('matches the tag and the state exactly, and needs every filter to pass', () => {
    expect(matchesFilters(book, { ...none, tag: 'systems', status: 'linked' })).toBe(true);
    expect(matchesFilters(book, { ...none, tag: 'system' })).toBe(false);
    expect(matchesFilters(book, { ...none, status: 'parsed' })).toBe(false);
    expect(matchesFilters(book, { ...none, tag: 'systems', q: 'flow' })).toBe(false);
  });
});

describe('libraryHref', () => {
  it('keeps the filters and adds the order unless it is the default', () => {
    expect(libraryHref({ ...none, q: 'flow' }, 'read')).toBe('/library?q=flow');
    expect(libraryHref({ ...none, q: 'flow' }, 'title')).toBe('/library?q=flow&sort=title');
    expect(libraryHref(none, 'author')).toBe('/library?sort=author');
    expect(libraryHref(none, 'read')).toBe('/library');
  });
});

describe('noMatchMessage', () => {
  it('names what was asked for', () => {
    expect(noMatchMessage({ ...none, q: 'x' })).toBe('No books match “x”.');
    expect(noMatchMessage({ ...none, q: 'loops', author: 'Meadows', tag: 'systems' })).toBe(
      'No books match “loops” by “Meadows” tagged “systems”.',
    );
  });
});

describe('resultSummary', () => {
  it('counts the shelf, or the matches out of it while filtering', () => {
    expect(resultSummary(2, 2, false)).toBe('2 books');
    expect(resultSummary(1, 1, false)).toBe('1 book');
    expect(resultSummary(0, 5, true)).toBe('0 of 5 books');
  });
});

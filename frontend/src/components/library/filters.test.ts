import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  filterHref,
  hasFilters,
  libraryHref,
  matchesFilters,
  NO_FILTERS,
  noMatchMessage,
  parseFilters,
  resultSummary,
  tagCloud,
  type LibraryFilters,
} from './filters';

const parse = (qs: string) => parseFilters(new URLSearchParams(qs));

describe('parseFilters', () => {
  it('reads every filter, trimmed', () => {
    expect(parse('tag=systems&status=parsed&genre=paper&reading=finished&study=ready&theme=Machine+learning&author=%20Meadows%20&q=loops')).toEqual({
      tag: 'systems',
      status: 'parsed',
      genre: 'paper',
      reading: 'finished',
      study: 'ready',
      theme: 'Machine learning',
      author: 'Meadows',
      q: 'loops',
    });
  });

  it('drops blanks and unknown values', () => {
    expect(parse('tag=&status=shelved&genre=poem&reading=skimmed&study=all&author=%20%20')).toEqual(NO_FILTERS);
  });

  it('caps overlong values at the API’s limits', () => {
    expect(parse(`tag=${'x'.repeat(100)}`).tag).toHaveLength(64);
  });
});

describe('filterHref', () => {
  const current: LibraryFilters = { ...NO_FILTERS, tag: 'systems', status: 'parsed' };

  it('changes one filter and keeps the rest', () => {
    expect(filterHref(current, { tag: 'queues' })).toBe('/library?tag=queues&status=parsed');
  });

  it('clears a filter with null, and the whole query when nothing is left', () => {
    expect(filterHref(current, { status: null })).toBe('/library?tag=systems');
    expect(filterHref(current, { tag: null, status: null })).toBe('/library');
  });

  it('encodes values', () => {
    expect(filterHref(NO_FILTERS, { q: 'a&b c' })).toBe('/library?q=a%26b+c');
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

const none = NO_FILTERS;

describe('matchesFilters', () => {
  const book = {
    title: 'Thinking in Systems',
    authors: ['Donella Meadows'],
    tags: ['systems'],
    status: 'linked',
    genre: 'book',
    reading: 'finished',
    study: 'drafts',
    theme: 'Systems thinking',
  };

  it('passes every book when nothing is set', () => {
    expect(matchesFilters(book, none)).toBe(true);
  });

  it('matches words in the title and the authors, ignoring case', () => {
    expect(matchesFilters(book, { ...none, q: 'in sys' })).toBe(true);
    expect(matchesFilters(book, { ...none, q: 'MEADOWS' })).toBe(true);
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

  it('matches the facets exactly', () => {
    expect(matchesFilters(book, { ...none, genre: 'book', reading: 'finished', study: 'drafts' })).toBe(true);
    expect(matchesFilters(book, { ...none, genre: 'paper' })).toBe(false);
    expect(matchesFilters(book, { ...none, reading: 'unread' })).toBe(false);
    expect(matchesFilters(book, { ...none, study: 'ready' })).toBe(false);
    expect(matchesFilters(book, { ...none, theme: 'Systems thinking' })).toBe(true);
    expect(matchesFilters(book, { ...none, theme: 'none' })).toBe(false);
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
    expect(noMatchMessage({ ...none, genre: 'paper', q: 'bert' })).toBe('No papers match “bert”.');
    expect(noMatchMessage({ ...none, genre: 'article' })).toBe('No articles on the shelf yet.');
    expect(noMatchMessage({ ...none, genre: 'paper', reading: 'finished', study: 'ready' })).toBe(
      'No papers you have finished with study material ready.',
    );
    expect(noMatchMessage({ ...none, theme: 'Career' })).toBe('No books under “Career”.');
    expect(noMatchMessage({ ...none, theme: 'none' })).toBe('No books without a theme yet.');
  });
});

describe('activeFilters', () => {
  it('names each filter that is set, in URL order, in the reader’s words', () => {
    expect(activeFilters({ ...none, tag: 'career', genre: 'paper', reading: 'unread', theme: 'none', q: 'flow' })).toEqual([
      { key: 'q', label: '“flow”', remove: 'Remove the filter “flow”' },
      { key: 'genre', label: 'Papers', remove: 'Remove the filter Papers' },
      { key: 'reading', label: 'Not started', remove: 'Remove the filter Not started' },
      { key: 'theme', label: 'No theme yet', remove: 'Remove the filter No theme yet' },
      { key: 'tag', label: 'career', remove: 'Remove the filter career' },
    ]);
    expect(activeFilters(none)).toEqual([]);
  });
});

describe('resultSummary', () => {
  it('counts the shelf, or the matches out of it while filtering', () => {
    expect(resultSummary(2, 2, false)).toBe('2 books');
    expect(resultSummary(1, 1, false)).toBe('1 book');
    expect(resultSummary(0, 5, true)).toBe('0 of 5 books');
  });
});

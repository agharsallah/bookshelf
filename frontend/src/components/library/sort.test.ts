import { describe, expect, it } from 'vitest';
import { authorKey, parseSort, sortBy, sortKeys, stickerFor, titleKey, type Sort, type SortKeys } from './sort';
import { summary } from './test-books';

const book = (over: Partial<SortKeys>): SortKeys => ({
  title: 'b',
  author: 'b',
  added: '2026-01-01',
  read: '',
  progress: -1,
  length: 0,
  year: 0,
  study: 0,
  ...over,
});
const order = (books: Record<string, SortKeys>, sort: Sort) =>
  sortBy(Object.keys(books), (name) => books[name] as SortKeys, sort);

describe('parseSort', () => {
  it('accepts the known orders and falls back to recently read', () => {
    expect(parseSort('title')).toBe('title');
    expect(parseSort('added')).toBe('added');
    expect(parseSort('length')).toBe('length');
    expect(parseSort('pages')).toBe('read');
    expect(parseSort(null)).toBe('read');
  });
});

describe('titleKey and authorKey', () => {
  it('files titles without a leading article, case-folded', () => {
    expect(titleKey('The Goal')).toBe('goal');
    expect(titleKey('An Elegant Puzzle')).toBe('elegant puzzle');
    expect(titleKey('Theory of Constraints')).toBe('theory of constraints');
  });

  it('sorts by the first author’s surname', () => {
    expect(authorKey(['Donella Meadows', 'Jorgen Randers'])).toBe('meadows');
    expect(authorKey(['Reinertsen, Donald'])).toBe('reinertsen');
    expect(authorKey([])).toBe('');
  });

  it('builds the keys from a document and its reading', () => {
    const doc = summary('goal', {
      title: 'The Goal',
      authors: ['Eliyahu Goldratt'],
      created_at: 'c',
      year: 1984,
      page_count: null,
      counts: { chapters: 4, blocks: 800, figures: 0, notes: 0 },
      artifacts: { approved: 7, draft: 1, needs_review: 0, rejected: 0 },
    });
    expect(sortKeys(doc, { share: 0, lastRead: null })).toEqual({
      title: 'goal',
      author: 'goldratt',
      added: 'c',
      read: '',
      progress: -1,
      length: 100,
      year: 1984,
      study: 7,
    });
    expect(sortKeys(doc, { share: 0.4, lastRead: 't' })).toMatchObject({ read: 't', progress: 0.4 });
  });
});

describe('sortBy', () => {
  const books = {
    unreadNew: book({ title: 'c', author: '', added: '2026-09-03' }),
    readLong: book({ title: 'a', author: 'zed', added: '2026-09-01', read: '2026-09-10' }),
    readNow: book({ title: 'b', author: 'abe', added: '2026-09-02', read: '2026-09-20' }),
    unreadOld: book({ title: 'd', author: 'abe', added: '2026-08-01' }),
  };

  it('puts the latest read first, then unread books newest added first', () => {
    expect(order(books, 'read')).toEqual(['readNow', 'readLong', 'unreadNew', 'unreadOld']);
  });

  it('orders by date added, newest first', () => {
    expect(order(books, 'added')).toEqual(['unreadNew', 'readNow', 'readLong', 'unreadOld']);
  });

  it('orders by title', () => {
    expect(order(books, 'title')).toEqual(['readLong', 'readNow', 'unreadNew', 'unreadOld']);
  });

  it('orders by author, then title, with books without an author last', () => {
    expect(order(books, 'author')).toEqual(['readNow', 'unreadOld', 'readLong', 'unreadNew']);
  });

  it('puts the most read, longest, newest published and best stocked first, unknowns last', () => {
    const numbers = {
      a: book({ progress: 0.2, length: 300, year: 2019, study: 3, added: '2026-09-01' }),
      b: book({ progress: 1, length: 0, year: 0, study: 40, added: '2026-09-02' }),
      c: book({ progress: -1, length: 120, year: 2024, study: 0, added: '2026-09-03' }),
      d: book({ progress: 0, length: 900, year: 2001, study: 0, added: '2026-09-04' }),
    };
    expect(order(numbers, 'progress')).toEqual(['b', 'a', 'd', 'c']);
    expect(order(numbers, 'length')).toEqual(['d', 'a', 'c', 'b']);
    expect(order(numbers, 'year')).toEqual(['c', 'a', 'd', 'b']);
    // Ties (c and d have nothing) fall back to the newest added.
    expect(order(numbers, 'study')).toEqual(['b', 'a', 'd', 'c']);
  });

  it('sorts numbers in titles naturally', () => {
    expect(order({ ten: book({ title: 'part 10' }), two: book({ title: 'part 2' }) }, 'title')).toEqual(['two', 'ten']);
  });
});

describe('stickerFor', () => {
  it('shows what the order sorts by on the spine, the year otherwise', () => {
    expect(stickerFor('progress')).toBe('progress');
    expect(stickerFor('length')).toBe('length');
    expect(stickerFor('title')).toBe('year');
  });
});

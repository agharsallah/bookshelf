import { describe, expect, it } from 'vitest';
import { authorKey, parseSort, sortBy, sortKeys, titleKey, type Sort, type SortKeys } from './sort';

const book = (over: Partial<SortKeys>): SortKeys => ({ title: 'b', author: 'b', added: '2026-01-01', read: '', ...over });
const order = (books: Record<string, SortKeys>, sort: Sort) =>
  sortBy(Object.keys(books), (name) => books[name] as SortKeys, sort);

describe('parseSort', () => {
  it('accepts the known orders and falls back to recently read', () => {
    expect(parseSort('title')).toBe('title');
    expect(parseSort('added')).toBe('added');
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

  it('builds the keys from a document and when it was last read', () => {
    expect(sortKeys({ title: 'The Goal', authors: ['Eliyahu Goldratt'], created_at: 'c' }, null)).toEqual({
      title: 'goal',
      author: 'goldratt',
      added: 'c',
      read: '',
    });
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

  it('sorts numbers in titles naturally', () => {
    expect(order({ ten: book({ title: 'part 10' }), two: book({ title: 'part 2' }) }, 'title')).toEqual(['two', 'ten']);
  });
});

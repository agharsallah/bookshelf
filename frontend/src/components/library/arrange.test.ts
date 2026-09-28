import { describe, expect, it } from 'vitest';
import { arrange } from './arrange';
import type { Dimension } from './facets';
import type { SortKeys } from './sort';

interface Book {
  name: string;
  kind: string;
  reading: string;
  keys: SortKeys;
}

const keys = (title: string): SortKeys => ({ title, author: '', added: '', read: '', progress: -1, length: 0, year: 0, study: 0 });
const book = (name: string, kind: string, reading = 'unread'): Book => ({ name, kind, reading, keys: keys(name) });
const books = [book('d', 'paper'), book('a', 'book', 'finished'), book('c', 'book'), book('b', 'paper', 'reading')];
const dividers = [
  { dimension: 'kind', bucket: 'article', index: 2 },
  { dimension: 'kind', bucket: 'book', index: 0 },
  { dimension: 'reading', bucket: 'unread', index: 2 },
  { dimension: 'kind', bucket: 'paper', index: 1 },
];
const bucketOf = (b: Book, dimension: Dimension) => (dimension === 'kind' ? b.kind : dimension === 'reading' ? b.reading : 'none');
const names = (items: (Book | (typeof dividers)[number])[]) =>
  items.map((item) => ('name' in item ? item.name : `|${item.dimension}:${item.bucket}`));

describe('arrange', () => {
  it('sorts the books and leaves the dividers at the end when not grouped', () => {
    expect(names(arrange(books, dividers, (b) => b.keys, bucketOf, 'title', null))).toEqual([
      'a',
      'b',
      'c',
      'd',
      '|kind:article',
      '|kind:book',
      '|reading:unread',
      '|kind:paper',
    ]);
  });

  it('stands each group behind its divider, in the dimension’s order, sorted within', () => {
    expect(names(arrange(books, dividers, (b) => b.keys, bucketOf, 'title', 'kind'))).toEqual([
      '|kind:book',
      'a',
      'c',
      '|kind:paper',
      'b',
      'd',
      '|kind:article',
      '|reading:unread',
    ]);
  });

  it('stands books of a group without a divider after the groups', () => {
    const odd = [...books, book('e', 'poem')];
    expect(names(arrange(odd, dividers, (b) => b.keys, bucketOf, 'title', 'kind'))).toEqual([
      '|kind:book',
      'a',
      'c',
      '|kind:paper',
      'b',
      'd',
      '|kind:article',
      'e',
      '|reading:unread',
    ]);
  });
});

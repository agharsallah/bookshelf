import { describe, expect, it } from 'vitest';
import { shelfPalette } from './facets';
import { NO_FILTERS } from './filters';
import { dividerCards, libraryItems } from './items';
import { summary } from './test-books';

const none = NO_FILTERS;

const documents = [
  summary('old', { title: 'Alpha', created_at: '2026-01-01T00:00:00Z' }),
  summary('new', { title: 'Beta', created_at: '2026-09-01T00:00:00Z' }),
  summary('read', { title: 'Gamma', created_at: '2026-05-01T00:00:00Z' }),
];
const extras = { read: { reading: { share: 0.2, lastRead: '2026-09-20T00:00:00Z', resume: 'ch01/p002' }, materials: [] } };

describe('libraryItems', () => {
  it('orders the books, marks the one read last as current, and knows unread ones', () => {
    const items = libraryItems(documents, extras, none, 'read');
    expect(items.map((i) => i.doc.slug)).toEqual(['read', 'new', 'old']);
    expect(items.map((i) => i.current)).toEqual([true, false, false]);
    expect(items[1]?.reading.lastRead).toBeNull();
    expect(items[1]?.materials).toBeNull();
  });

  it('keeps every book but hides the ones the filters leave out', () => {
    const items = libraryItems(documents, extras, { ...none, q: 'et' }, 'title');
    expect(items.map((i) => [i.doc.slug, i.hidden])).toEqual([
      ['old', true],
      ['new', false],
      ['read', true],
    ]);
  });

  it('places each book in the facets, and filters on them', () => {
    const items = libraryItems(documents, extras, { ...none, reading: 'reading' }, 'title');
    expect(items.map((i) => [i.doc.slug, i.buckets.reading, i.hidden])).toEqual([
      ['old', 'unread', true],
      ['new', 'unread', true],
      ['read', 'reading', false],
    ]);
  });
});

describe('dividerCards', () => {
  it('makes a card per bucket of every dimension, counting the books let through', () => {
    const items = libraryItems(documents, extras, none, 'title');
    items[0] = { ...items[0], hidden: true } as (typeof items)[number];
    const cards = dividerCards(shelfPalette(documents), items);
    expect(cards).toHaveLength(10); // 3 kinds, 3 reading, 3 study, and "No theme yet"
    expect(cards.at(-1)).toMatchObject({ dimension: 'theme', bucket: 'none', count: 2 }); // one of three hidden
    expect(cards.filter((c) => c.dimension === 'reading').map((c) => [c.bucket, c.index, c.count])).toEqual([
      ['reading', 0, 1],
      ['finished', 1, 0],
      ['unread', 2, 1],
    ]);
  });
});

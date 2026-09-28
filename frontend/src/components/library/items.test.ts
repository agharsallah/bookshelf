import { describe, expect, it } from 'vitest';
import { libraryItems } from './items';
import { summary } from './test-books';

const none = { tag: null, status: null, genre: null, author: null, q: null };

describe('libraryItems', () => {
  const documents = [
    summary('old', { title: 'Alpha', created_at: '2026-01-01T00:00:00Z' }),
    summary('new', { title: 'Beta', created_at: '2026-09-01T00:00:00Z' }),
    summary('read', { title: 'Gamma', created_at: '2026-05-01T00:00:00Z' }),
  ];
  const extras = { read: { reading: { share: 0.2, lastRead: '2026-09-20T00:00:00Z' }, materials: [] } };

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
});

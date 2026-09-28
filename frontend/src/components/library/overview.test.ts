import { describe, expect, it } from 'vitest';
import { shelfSentence, shelfTotals } from './overview';
import { summary } from './test-books';

describe('shelfTotals', () => {
  it('adds up chapters read by share, material ready, drafts and notes', () => {
    const totals = shelfTotals([
      {
        doc: summary('a', {
          counts: { chapters: 10, blocks: 0, figures: 0, notes: 3 },
          artifacts: { approved: 5, draft: 2, needs_review: 1, rejected: 4 },
        }),
        reading: { share: 0.45 },
      },
      { doc: summary('b', { counts: { chapters: 4, blocks: 0, figures: 0, notes: 1 } }), reading: { share: 1 } },
    ]);
    expect(totals).toEqual({ chapters: 14, chaptersRead: 9, ready: 5, drafts: 3, notes: 4 });
  });
});

describe('shelfSentence', () => {
  it('names the kinds on the shelf, leaving out the empty ones', () => {
    const kinds = (book: number, paper: number, article: number) => [
      { value: 'book', count: book },
      { value: 'paper', count: paper },
      { value: 'article', count: article },
    ];
    expect(shelfSentence(kinds(3, 2, 0))).toBe('3 books and 2 papers');
    expect(shelfSentence(kinds(1, 1, 1))).toBe('1 book, 1 paper and 1 article');
    expect(shelfSentence(kinds(0, 0, 1))).toBe('1 article');
    expect(shelfSentence(kinds(0, 0, 0))).toBe('Nothing');
  });
});

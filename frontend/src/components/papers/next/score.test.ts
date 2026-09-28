import { describe, expect, it } from 'vitest';
import { leadingTerms, scoreScale, scoreTerms, signed } from './score';

describe('scoreTerms', () => {
  it('lists the terms that moved the score, in the backend order, with plain words', () => {
    const terms = scoreTerms({ recency: 0.25, source: 1, rating: 0, shelf: 0.5 });
    expect(terms.map((t) => t.key)).toEqual(['source', 'shelf', 'recency']);
    expect(terms[0]?.name).toBe('How it was found');
    expect(terms[0]?.explain).toMatch(/bibliography/);
  });

  it('scales bars to the largest term, and marks a term that lowers the score', () => {
    const terms = scoreTerms({ source: 1, rating: -0.75 }, 1.5);
    expect(terms.find((t) => t.key === 'source')?.length).toBeCloseTo(2 / 3);
    const rating = terms.find((t) => t.key === 'rating');
    expect(rating?.lowers).toBe(true);
    expect(rating?.length).toBeCloseTo(0.5);
  });

  it('keeps an unknown term after the known ones, named from its key', () => {
    const terms = scoreTerms({ citations: 0.2, novelty_bonus: 0.1 });
    expect(terms.map((t) => t.name)).toEqual(['Citations', 'novelty bonus']);
  });

  it('drops rounding noise and non-numbers', () => {
    expect(scoreTerms({ source: 0.00001, shelf: Number.NaN })).toEqual([]);
  });
});

describe('scoreScale', () => {
  it('is the largest absolute part across candidates', () => {
    expect(scoreScale([{ source: 1 }, { rating: -1.5, shelf: 0.2 }])).toBe(1.5);
    expect(scoreScale([])).toBe(0);
  });
});

describe('leadingTerms', () => {
  it('names the largest raising terms, never one that lowers', () => {
    const terms = scoreTerms({ source: 0.5, rating: -1.5, shelf: 1, recency: 0.1 });
    expect(leadingTerms(terms).map((t) => t.key)).toEqual(['shelf', 'source']);
  });
});

describe('signed', () => {
  it('writes a sign on both sides of zero', () => {
    expect(signed(0.842)).toBe('+0.84');
    expect(signed(-0.75)).toBe('−0.75');
  });
});

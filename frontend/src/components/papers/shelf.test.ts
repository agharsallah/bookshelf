import { describe, expect, it } from 'vitest';
import { artifactState } from './fixtures';
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import { activeFilters, artifactChips, clip, tldrByDocument, hasShelfFilters, NO_FILTERS, papersQuery, parseShelfFilters, shelfHref, shelfSummary } from './shelf';

const parse = (qs: string) => parseShelfFilters(new URLSearchParams(qs));

describe('parseShelfFilters', () => {
  it('reads every filter and the order from the URL', () => {
    expect(parse('q=%20attention%20&venue=NeurIPS&year=2017&stars=4&pass=0&verdict=must_read&sort=year')).toEqual({
      q: 'attention',
      venue: 'NeurIPS',
      year: 2017,
      stars: 4,
      pass: 0,
      verdict: 'must_read',
      sort: 'year',
    });
  });

  it('drops blanks, unknown values and numbers out of range', () => {
    expect(parse('q=%20&stars=6&pass=4&year=twenty&verdict=meh&sort=random')).toEqual(NO_FILTERS);
    expect(parse('stars=0').stars).toBeNull();
  });
});

describe('papersQuery', () => {
  it('names stars as the API does and leaves unset filters out', () => {
    expect(papersQuery({ ...NO_FILTERS, stars: 3, pass: 2 })).toEqual({ limit: 100, sort: 'recent', min_stars: 3, pass: 2 });
  });

  it('keeps pass 0 (not started), which is not "unset"', () => {
    expect(papersQuery({ ...NO_FILTERS, pass: 0 }).pass).toBe(0);
  });
});

describe('shelfHref', () => {
  it('changes one filter and keeps the others, leaving the default order out', () => {
    const filters = { ...NO_FILTERS, venue: 'ICML', stars: 4 };
    expect(shelfHref(filters, { year: 2020 })).toBe('/papers?venue=ICML&year=2020&stars=4');
    expect(shelfHref(filters, { venue: null })).toBe('/papers?stars=4');
    expect(shelfHref(NO_FILTERS)).toBe('/papers');
    expect(shelfHref(NO_FILTERS, { sort: 'stars', pass: 0 })).toBe('/papers?pass=0&sort=stars');
  });

  it('round-trips through the parser', () => {
    const filters = { ...NO_FILTERS, q: 'a&b c', verdict: 'skim' as const, sort: 'cited_by' as const };
    expect(parse(shelfHref(filters).split('?')[1] ?? '')).toEqual(filters);
  });
});

describe('activeFilters', () => {
  it('gives each filter in force a chip that removes only it', () => {
    const chips = activeFilters({ ...NO_FILTERS, venue: 'ACL', pass: 0, sort: 'title' });
    expect(chips).toEqual([
      { label: 'ACL', clearHref: '/papers?pass=0&sort=title' },
      { label: 'Not started', clearHref: '/papers?venue=ACL&sort=title' },
    ]);
    expect(hasShelfFilters({ ...NO_FILTERS, sort: 'title' })).toBe(false);
  });
});

describe('shelfSummary', () => {
  it('counts papers, and how many match while filtering', () => {
    expect(shelfSummary(1, 1, false)).toBe('1 paper');
    expect(shelfSummary(2, 5, true)).toBe('2 of 5 papers');
  });
});

describe('artifactChips', () => {
  it('shows one chip per type, folding explainer levels into a count', () => {
    const chips = artifactChips([
      artifactState(),
      artifactState({ type: 'paper_explainer', variant: 'newcomer', review: 'draft' }),
      artifactState({ type: 'paper_explainer', variant: 'expert', review: 'approved' }),
      artifactState({ type: 'claim_set', review: 'rejected' }),
    ]);
    expect(chips).toEqual([
      { label: 'Paper card', standing: 'approved' },
      { label: 'Paper explainer (2 levels)', standing: 'approved' },
    ]);
  });

  it('marks a type whose versions all wait for review as a draft', () => {
    expect(artifactChips([artifactState({ review: 'needs_review' })])).toEqual([{ label: 'Paper card', standing: 'draft' }]);
  });
});

const card = (document_id: string, text: string, review: ArtifactPublic['review'], version = 1) =>
  ({ id: `${document_id}-${version}`, document_id, type: 'paper_card', anchor: null, version, review, body: { tldr: [{ text, cites: [] }] } }) as unknown as ArtifactPublic;

describe('tldrByDocument', () => {
  it('takes each paper’s tl;dr from its approved card over a newer draft', () => {
    expect(tldrByDocument([card('d1', 'Approved words.', 'approved', 1), card('d1', 'Draft words.', 'draft', 2), card('d2', 'Other.', 'draft')])).toEqual({
      d1: 'Approved words.',
      d2: 'Other.',
    });
  });

  it('skips rejected cards and empty tl;drs', () => {
    expect(tldrByDocument([card('d1', 'No.', 'rejected'), card('d2', '  ', 'approved')])).toEqual({});
  });
});

describe('clip', () => {
  it('cuts long text at a word, with an ellipsis', () => {
    expect(clip('one two three four', 12)).toBe('one two…');
    expect(clip('  short   text ', 50)).toBe('short text');
  });
});

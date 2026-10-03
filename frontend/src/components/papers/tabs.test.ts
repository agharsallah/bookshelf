import { describe, expect, it } from 'vitest';
import { artifactState } from './fixtures';
import { DEFAULT_TAB, PAPER_TABS, paperHref, paperTab, readinessOf, tabItems } from './tabs';

describe('the paper tab registry', () => {
  it('opens on the card and knows each tab by its URL segment', () => {
    expect(DEFAULT_TAB).toBe('card');
    expect(paperTab('explain')?.types).toEqual(['paper_explainer']);
    expect(paperTab('nonsense')).toBeNull();
    expect(paperTab(undefined)).toBeNull();
  });

  it('has every tab of docs/PAPERS.md §8, in its order', () => {
    expect(PAPER_TABS.map((t) => t.key)).toEqual(['card', 'explain', 'math', 'claims', 'results', 'references', 'notation', 'review', 'club', 'build']);
  });

  it('shows the review tab ready once either the assessment or the peer review is approved', () => {
    const review = paperTab('review');
    expect(review).not.toBeNull();
    expect(readinessOf(review!, [artifactState({ type: 'paper_review', review: 'approved' })])).toBe('approved');
    expect(readinessOf(review!, [artifactState({ type: 'paper_assessment', review: 'draft' })])).toBe('draft');
  });

  it('shows every study artifact type on exactly one tab', () => {
    const types = PAPER_TABS.flatMap((t) => [...t.types]);
    expect(new Set(types).size).toBe(types.length);
    for (const type of ['claim_set', 'results_table', 'notation_table', 'paper_assessment', 'paper_review', 'journal_club', 'math_explainer'] as const) {
      expect(types).toContain(type);
    }
  });

  it('has unique keys', () => {
    const keys = PAPER_TABS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('links to a tab, with an optional query', () => {
    expect(paperHref('bert')).toBe('/documents/bert/paper/card');
    expect(paperHref('bert', 'explain', { level: 'expert' })).toBe('/documents/bert/paper/explain?level=expert');
  });
});

describe('readinessOf', () => {
  const card = { types: ['paper_card'] as const };

  it('is approved once any version of the tab’s material is approved', () => {
    expect(readinessOf(card, [artifactState({ review: 'draft' }), artifactState({ review: 'approved' })])).toBe('approved');
  });

  it('is a draft while only unreviewed versions exist, and missing without any', () => {
    expect(readinessOf(card, [artifactState({ review: 'needs_review' })])).toBe('draft');
    expect(readinessOf(card, [artifactState({ type: 'paper_explainer' })])).toBe('missing');
    expect(readinessOf(card, [artifactState({ review: 'rejected' })])).toBe('missing');
  });

  it('calls a tab that reads tables data, whatever exists', () => {
    expect(readinessOf({ types: [] }, [])).toBe('data');
  });
});

describe('tabItems', () => {
  it('lists every tab with its link, readiness and which one is open', () => {
    const items = tabItems('bert', [artifactState({ type: 'paper_explainer', review: 'draft', variant: 'expert' })], 'explain');
    expect(items.map((i) => [i.key, i.readiness, i.current])).toEqual([
      ['card', 'missing', false],
      ['explain', 'draft', true],
      ['math', 'missing', false],
      ['claims', 'missing', false],
      ['results', 'missing', false],
      ['references', 'data', false],
      ['notation', 'missing', false],
      ['review', 'missing', false],
      ['club', 'missing', false],
      ['build', 'data', false],
    ]);
    expect(items[5]?.href).toBe('/documents/bert/paper/references');
  });
});

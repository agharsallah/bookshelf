import { describe, expect, it } from 'vitest';
import { intentCounts, parseReferenceFilters, referencesHref, referencesQuery, referenceStanding, referenceTitle } from './references';

describe('referenceStanding', () => {
  it('prefers the shelf copy, then the reading candidate', () => {
    const target = { id: 't', slug: 'fid', title: 'Fusion-in-Decoder' };
    const candidate = { id: 'c1', status: 'suggested' as const, score: 0.8 };
    expect(referenceStanding({ target, candidate })).toEqual({ kind: 'shelf', href: '/documents/fid', title: 'Fusion-in-Decoder' });
    expect(referenceStanding({ target: null, candidate })).toEqual({ kind: 'candidate', id: 'c1', status: 'suggested' });
    expect(referenceStanding({ target: null, candidate: null })).toEqual({ kind: 'none' });
  });
});

describe('referenceTitle', () => {
  it('falls back to the raw entry when no title was parsed', () => {
    expect(referenceTitle({ title: '  ', raw: '[3] A. Author. Something. 2019.' })).toBe('[3] A. Author. Something. 2019.');
    expect(referenceTitle({ title: 'Deep Residual Learning', raw: 'x' })).toBe('Deep Residual Learning');
  });
});

describe('reference filters', () => {
  it('read the URL, send the API its names, and link back', () => {
    const filters = parseReferenceFilters(new URLSearchParams('intent=extends&shelf=1'));
    expect(filters).toEqual({ intent: 'extends', onShelf: true });
    expect(referencesQuery(filters)).toEqual({ intent: 'extends', on_shelf: true });
    expect(referencesHref('bert', filters)).toBe('/documents/bert/paper/references?intent=extends&shelf=1');
    expect(parseReferenceFilters(new URLSearchParams('intent=likes'))).toEqual({ intent: null, onShelf: false });
    expect(referencesQuery({ intent: null, onShelf: false })).toEqual({});
  });

  it('count the intents present, in the vocabulary’s order', () => {
    expect(intentCounts([{ intent: 'uses' }, { intent: null }, { intent: 'background' }, { intent: 'uses' }])).toEqual([
      { intent: 'background', count: 1 },
      { intent: 'uses', count: 2 },
    ]);
  });
});

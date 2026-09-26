import { describe, expect, it } from 'vitest';
import { SEARCH_MODES } from '../../lib/api/types/search';
import { MODE_OPTIONS, optionsSummary } from './modes';
import { emptySearch } from './url-state';

describe('search modes', () => {
  it('describes every mode the API accepts, Auto first', () => {
    expect(MODE_OPTIONS.map((m) => m.mode).sort()).toEqual([...SEARCH_MODES].sort());
    expect(MODE_OPTIONS[0]?.mode).toBe('auto');
  });

  it('summarises nothing when the options are the defaults', () => {
    expect(optionsSummary(emptySearch)).toBe('');
  });

  it('names a forced mode and counts the filters in plain words', () => {
    expect(optionsSummary({ ...emptySearch, mode: 'lexical' })).toBe('Exact words');
    expect(optionsSummary({ ...emptySearch, tags: ['systems'] })).toBe('1 filter');
    expect(optionsSummary({ ...emptySearch, mode: 'synthesis', tags: ['a'], types: ['faq'] })).toBe('Across books, 2 filters');
  });
});

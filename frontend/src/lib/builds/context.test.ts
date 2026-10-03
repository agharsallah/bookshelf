import { describe, expect, it } from 'vitest';
import type { BuildReference, ContextSection, SuggestedReference } from '../api/types/builds';
import { contextOptions, contextSummary, formatCount, fromSuggestion, groupSuggestions, isAdded, linkReference, validateReferences, validateUrl } from './context';

const sections: ContextSection[] = [
  { key: 'tldr', title: 'TL;DR', markdown: '', words: 40 },
  { key: 'equations', title: 'Equations', markdown: '', words: 300 },
  { key: 'results', title: 'Results', markdown: '', words: 1800 },
];
const link = (url: string): BuildReference => linkReference(url, '', '');

describe('contextSummary', () => {
  it('counts the words of the sections kept, the sections, the references and the notes', () => {
    expect(contextSummary({ sections, off: ['equations'], references: [link('https://a.org'), link('https://b.org')], notes: 'mind the tokenizer' })).toBe(
      'Paper brief · 1 840 words · 2 of 3 sections · 2 references · notes',
    );
    expect(contextSummary({ sections, off: [], references: [link('https://a.org')], notes: '  ' })).toBe('Paper brief · 2 140 words · all 3 sections · 1 reference');
  });

  it('still says what is off before the paper brief has loaded', () => {
    expect(contextSummary({ sections: null, off: ['claims'], references: [], notes: '' })).toBe('Paper brief · 1 section off');
  });
});

describe('contextOptions', () => {
  it('sends null to keep every section, else the keys kept in order', () => {
    expect(contextOptions([], ' ')).toEqual({ sections: null, notes: null });
    expect(contextOptions(['tldr', 'question', 'core_ideas', 'how_it_works', 'equations', 'setup', 'results', 'claims'], 'n').sections).toEqual(['limitations']);
  });
});

describe('references', () => {
  it('accepts only http(s) links', () => {
    expect(validateUrl('https://github.com/x')).toBeNull();
    expect(validateUrl('ftp://x.org')).toMatch(/http/);
    expect(validateUrl('github.com/x')).toMatch(/not a link/);
    expect(validateUrl(' ')).toMatch(/Paste/);
  });

  it('names a link by its host when you give no title, and snapshots it', () => {
    expect(linkReference(' https://www.example.com/post ', ' ', ' why ')).toEqual({ kind: 'url', url: 'https://www.example.com/post', document_id: null, title: 'example.com', note: 'why', snapshot: true });
  });

  it('knows a suggestion already added, link or shelf paper', () => {
    const shelf: SuggestedReference = { kind: 'shelf', url: null, document_id: 'd1', title: 'Bahdanau', source: 'shelf' };
    const code: SuggestedReference = { kind: 'url', url: 'https://github.com/x/', document_id: null, title: 'x', source: 'code' };
    const refs = [fromSuggestion(shelf), link('https://github.com/x')];
    expect(isAdded(refs, shelf)).toBe(true);
    expect(isAdded(refs, code)).toBe(true);
    expect(isAdded(refs, { kind: 'shelf', url: null, document_id: 'd2' })).toBe(false);
  });

  it('groups suggestions in a fixed order, leaving out empty groups', () => {
    const s = (source: SuggestedReference['source']): SuggestedReference => ({ kind: 'url', url: `https://${source}.org`, document_id: null, title: source, source });
    expect(groupSuggestions([s('cited'), s('code'), s('cited')]).map((g) => [g.label, g.items.length])).toEqual([
      ['Official code', 1],
      ['Cited works', 2],
    ]);
  });

  it('refuses more than 20 references or a blank title', () => {
    expect(validateReferences(Array.from({ length: 21 }, (_, i) => link(`https://x.org/${i}`)))).toMatch(/At most 20/);
    expect(validateReferences([{ ...link('https://x.org'), title: ' ' }])).toMatch(/title/);
    expect(validateReferences([link('https://x.org')])).toBeNull();
  });
});

describe('formatCount', () => {
  it('groups thousands with a narrow space', () => {
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1234567)).toBe('1 234 567');
  });
});

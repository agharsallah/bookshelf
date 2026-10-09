import { describe, expect, it } from 'vitest';
import { DYES } from '../library/facets';
import { makePill, MEADOWS } from '../../lib/pills/testing/fixtures';
import { citeReaderHref, documentDye, feedKey, primarySource, resolveCite } from './model';

describe('resolveCite', () => {
  const pill = makePill('insight', {
    cites: ['wiener-cybernetics:ch04/p007', 'ch01/p010'],
    sources: { 'ch01/p010': { document: { id: 'x', slug: 'meadows-systems', title: 'T' }, anchor: 'ch01/p010' } },
  });

  it('uses the pill’s sources first, then a slug prefix, then the fallback document', () => {
    expect(resolveCite(pill, 'ch01/p010', 'other')).toEqual({ slug: 'meadows-systems', anchor: 'ch01/p010' });
    expect(resolveCite(pill, 'wiener-cybernetics:ch04/p007', 'meadows-systems')).toEqual({ slug: 'wiener-cybernetics', anchor: 'ch04/p007' });
    expect(resolveCite(pill, 'ch09/p001', 'side-doc')).toEqual({ slug: 'side-doc', anchor: 'ch09/p001' });
  });

  it('opens the first cite, or the unit when there is none', () => {
    expect(primarySource(pill)).toEqual({ slug: 'wiener-cybernetics', anchor: 'ch04/p007' });
    expect(primarySource(makePill('quote', { cites: [], anchor: 'ch03' }))).toEqual({ slug: MEADOWS.slug, anchor: 'ch03' });
    expect(citeReaderHref({ slug: 'a b', anchor: 'ch01/p002' })).toBe('/documents/a%20b/read/ch01/p002');
  });
});

describe('documentDye', () => {
  it('gives a theme the same dye every time, and a book without one its kind’s', () => {
    const systems = documentDye({ genre: 'book', theme: 'Systems' });
    expect(documentDye({ genre: 'paper', theme: 'Systems' })).toBe(systems);
    expect(Object.values(DYES)).toContain(systems);
    expect(documentDye({ genre: 'paper', theme: null })).toBe(DYES.teal);
    expect(documentDye({ genre: 'book', theme: null })).toBe(DYES.ink);
  });
});

describe('feedKey', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => feedKey({ key: k, metaKey: false, ctrlKey: false, altKey: false, ...mods });

  it('maps the documented keys', () => {
    expect(['j', 'ArrowDown', ' ', 'k', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 's', 'o', '?', 'e', 'Escape'].map((k) => key(k))).toEqual([
      'next', 'next', 'next', 'previous', 'previous', 'stepRight', 'stepLeft', 'save', 'open', 'confusing', 'tooEasy', 'end',
    ]);
  });

  it('leaves other keys and shortcuts with modifiers alone', () => {
    expect(key('x')).toBeNull();
    expect(key('s', { metaKey: true })).toBeNull();
    expect(key('k', { ctrlKey: true })).toBeNull();
  });
});

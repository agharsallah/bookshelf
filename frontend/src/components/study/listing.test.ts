import { describe, expect, it } from 'vitest';
import { byLetter, letterOf, matches, normalize, runsOf } from './listing';

describe('runsOf', () => {
  it('groups contiguous items under their topic, keeping order', () => {
    const items = [
      { q: 'a', g: 'One' },
      { q: 'b', g: 'One' },
      { q: 'c', g: null },
      { q: 'd', g: 'Two' },
    ];
    expect(runsOf(items, (i) => i.g).map((r) => [r.group, r.items.map((i) => i.q)])).toEqual([
      ['One', ['a', 'b']],
      [null, ['c']],
      ['Two', ['d']],
    ]);
  });

  it('is empty for no items', () => {
    expect(runsOf([], () => null)).toEqual([]);
  });
});

describe('matches', () => {
  it('matches every word, in any order, ignoring case and accents', () => {
    expect(matches('story TELL', 'Which story should I tell?')).toBe(true);
    expect(matches('resume', 'Your résumé matters')).toBe(true);
    expect(matches('story layoff', 'Which story should I tell?')).toBe(false);
  });

  it('an empty or blank query matches everything', () => {
    expect(matches('   ', 'anything')).toBe(true);
  });

  it('normalizes whitespace', () => {
    expect(normalize('  A\n  b ')).toBe('a b');
  });
});

describe('the letter index', () => {
  it('files a term under its first letter, accents dropped; the rest under #', () => {
    expect(letterOf('élan')).toBe('E');
    expect(letterOf('STAR method')).toBe('S');
    expect(letterOf('360 review')).toBe('#');
    expect(letterOf('“Quoted”')).toBe('#');
  });

  it('lists letters A–Z then #, each with its terms sorted', () => {
    const terms = ['beta', '3-2-1', 'Alpha', 'apple', 'Bravo'];
    expect(byLetter(terms, (t) => t)).toEqual([
      { letter: 'A', items: ['Alpha', 'apple'] },
      { letter: 'B', items: ['beta', 'Bravo'] },
      { letter: '#', items: ['3-2-1'] },
    ]);
  });
});

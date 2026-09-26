import { describe, expect, it } from 'vitest';
import { MAX_SPINE_HEIGHT, shortTitle, spineAuthor, spineLook, titleFit, wrapLength } from './spine';

describe('spineLook', () => {
  it('is stable per slug and thicker for longer books', () => {
    const thin = spineLook({ slug: 'a', kind: 'pdf', page_count: 100 });
    expect(spineLook({ slug: 'a', kind: 'pdf', page_count: 100 })).toEqual(thin);
    expect(spineLook({ slug: 'a', kind: 'pdf', page_count: 800 }).width).toBeGreaterThan(thin.width);
  });
});

describe('spineAuthor', () => {
  it('shows the surname, and et al. for several authors', () => {
    expect(spineAuthor(['Donella Meadows'])).toBe('Meadows');
    expect(spineAuthor(['Meadows, Donella', 'Jorgen Randers'])).toBe('Meadows et al.');
    expect(spineAuthor([])).toBe('');
  });
});

describe('shortTitle', () => {
  it('drops the subtitle after a colon or dash', () => {
    expect(shortTitle('Thinking in Systems: A Primer')).toBe('Thinking in Systems');
    expect(shortTitle('The Goal — A Process of Ongoing Improvement')).toBe('The Goal');
    expect(shortTitle('Flow in Small Teams')).toBe('Flow in Small Teams');
  });
});

describe('wrapLength', () => {
  it('is the shortest line that wraps the words into that many lines', () => {
    const words = ['Mastering', 'Behavioral', 'Interviews'];
    expect(wrapLength(words, 1)).toBe(31);
    expect(wrapLength(words, 2)).toBe(20);
    expect(wrapLength(words, 3)).toBe(10);
  });
});

describe('titleFit', () => {
  const look = { width: 3.25, height: 16 };

  it('sets a short title large, in one line, at the spine’s own height', () => {
    const fit = titleFit('Drive', ['Daniel Pink'], look);
    expect(fit).toMatchObject({ text: 'Drive', size: 1, lines: 1, height: 16, clipped: false });
  });

  it('shows the whole short title, growing the spine or wrapping before it clips', () => {
    const fit = titleFit('Mastering Behavioral Interviews: The Guide to Storytelling in Tech', ['Austen McDonald'], look);
    expect(fit.text).toBe('Mastering Behavioral Interviews');
    expect(fit.clipped).toBe(false);
    expect(fit.lines).toBeGreaterThan(1);
    expect(fit.height).toBeGreaterThanOrEqual(16);
    expect(fit.height).toBeLessThanOrEqual(MAX_SPINE_HEIGHT);
  });

  it('shrinks the type for a long title on a thin spine, and clips only past the smallest size', () => {
    const long = titleFit('Principles of Product Development Flow and Second Generation Lean Product Development', [], { width: 2.4, height: 13 });
    expect(long.size).toBeLessThan(1);
    expect(long.height).toBeLessThanOrEqual(MAX_SPINE_HEIGHT);
    const absurd = titleFit('word '.repeat(80), [], { width: 2.4, height: 13 });
    expect(absurd).toMatchObject({ clipped: true, height: MAX_SPINE_HEIGHT });
  });
});

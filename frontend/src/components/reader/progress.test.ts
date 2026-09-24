import { describe, expect, it } from 'vitest';
import { minutesLeft, timeLeftLabel, wordCount, WORDS_PER_MINUTE } from './progress';

describe('reading progress', () => {
  it('counts words on whitespace', () => {
    expect([wordCount('  Slack is  not\nwaste. '), wordCount(''), wordCount('   ')]).toEqual([4, 0, 0]);
  });

  it('adds up the words from the block being read to the end, rounded up to a minute', () => {
    const words = [WORDS_PER_MINUTE * 2, WORDS_PER_MINUTE, 1];
    expect(minutesLeft(words, 0)).toBe(4);
    expect(minutesLeft(words, 1)).toBe(2);
    expect(minutesLeft(words, 2)).toBe(1);
    expect(minutesLeft(words, 3)).toBe(0);
    expect(minutesLeft(words, -1)).toBe(4);
  });

  it('says it in minutes, then hours', () => {
    expect([0, 1, 59, 60, 95].map(timeLeftLabel)).toEqual(['End of chapter', '1 min left', '59 min left', '1 h left', '1 h 35 min left']);
  });
});

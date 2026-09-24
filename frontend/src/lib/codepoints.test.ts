import { describe, expect, it } from 'vitest';
import { toCodePointOffset, toCodePointRange, toUtf16Offset, toUtf16Range } from './codepoints';

// '𝑥' and '😀' take two UTF-16 units each; 'é' written as e + U+0301 is two code points in both counts.
const text = 'a𝑥b😀cé';

describe('code point ⇄ UTF-16 offsets', () => {
  it.each([
    [0, 0],
    [1, 1],
    [3, 2],
    [4, 3],
    [6, 4],
    [9, 7],
  ])('UTF-16 offset %i is code point %i', (utf16, points) => {
    expect([toCodePointOffset(text, utf16), toUtf16Offset(text, points)]).toEqual([points, utf16]);
  });

  it('is the identity for BMP-only text', () => {
    expect(toCodePointRange('plain text', { start: 2, end: 7 })).toEqual({ start: 2, end: 7 });
  });

  it('round-trips a range and extends offsets past the end one to one', () => {
    expect(toUtf16Range(text, toCodePointRange(text, { start: 1, end: 6 }))).toEqual({ start: 1, end: 6 });
    expect([toCodePointOffset(text, 11), toUtf16Offset(text, 9)]).toEqual([9, 11]);
  });
});

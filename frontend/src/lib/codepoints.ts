/**
 * Offsets on the wire are code points, because the backend (Python) counts them that
 * way: note ranges are validated and sliced with `len(text)` / `text[start:end]`, and
 * search highlight ranges index the snippet the same way. JavaScript strings (and the
 * DOM) index UTF-16 code units, where an astral character (𝑥, many emoji) takes two.
 * Convert at the edge: UTF-16 inside the browser, code points on the wire.
 */

export interface OffsetRange {
  start: number;
  end: number;
}

function unitsAt(text: string, index: number): number {
  const code = text.codePointAt(index) ?? 0;
  return code > 0xffff ? 2 : 1;
}

/** A UTF-16 offset into `text` as a code-point offset. Offsets past the end extend 1:1. */
export function toCodePointOffset(text: string, utf16: number): number {
  let units = 0;
  let points = 0;
  while (units < utf16 && units < text.length) {
    units += unitsAt(text, units);
    points += 1;
  }
  return points + Math.max(0, utf16 - units);
}

/** A code-point offset into `text` as a UTF-16 offset. Offsets past the end extend 1:1. */
export function toUtf16Offset(text: string, codePoints: number): number {
  let units = 0;
  let points = 0;
  while (points < codePoints && units < text.length) {
    units += unitsAt(text, units);
    points += 1;
  }
  return units + Math.max(0, codePoints - points);
}

export function toCodePointRange(text: string, range: OffsetRange): OffsetRange {
  return { start: toCodePointOffset(text, range.start), end: toCodePointOffset(text, range.end) };
}

export function toUtf16Range(text: string, range: OffsetRange): OffsetRange {
  return { start: toUtf16Offset(text, range.start), end: toUtf16Offset(text, range.end) };
}

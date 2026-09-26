/**
 * List helpers shared by the FAQ and the glossary: topic runs, filter-as-you-type
 * matching, and the A–Z index.
 */

export interface Run<T> {
  /** The topic heading, or null for items without one. */
  group: string | null;
  items: T[];
}

/** Contiguous runs of the same group, in order (topics arrive in book order). */
export function runsOf<T>(items: readonly T[], groupOf: (item: T) => string | null): Run<T>[] {
  const runs: Run<T>[] = [];
  for (const item of items) {
    const group = groupOf(item);
    const last = runs.at(-1);
    if (last && last.group === group) last.items.push(item);
    else runs.push({ group, items: [item] });
  }
  return runs;
}

/** Lower case, accents dropped, whitespace collapsed. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when every word of the query appears somewhere in the text (an empty query matches all). */
export function matches(query: string, text: string): boolean {
  const words = normalize(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize(text);
  return words.every((word) => haystack.includes(word));
}

export const ALPHABET = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'] as const;
export type Letter = (typeof ALPHABET)[number];

/** Where a term files in the index: its first letter, or `#` for digits and symbols. */
export function letterOf(term: string): Letter {
  const first = normalize(term).charAt(0).toUpperCase();
  return (ALPHABET as readonly string[]).includes(first) && first !== '#' ? (first as Letter) : '#';
}

export interface LetterSection<T> {
  letter: Letter;
  items: T[];
}

/** Items filed by letter, A–Z then `#`, each letter's items sorted by term. */
export function byLetter<T>(items: readonly T[], termOf: (item: T) => string): LetterSection<T>[] {
  const filed = new Map<Letter, T[]>();
  for (const item of items) {
    const letter = letterOf(termOf(item));
    filed.set(letter, [...(filed.get(letter) ?? []), item]);
  }
  return ALPHABET.filter((letter) => filed.has(letter)).map((letter) => ({
    letter,
    items: [...(filed.get(letter) ?? [])].sort((a, b) => termOf(a).localeCompare(termOf(b), 'en', { sensitivity: 'base' })),
  }));
}

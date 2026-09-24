/**
 * How far through the chapter you are, and how long the rest should take:
 * words from the block being read to the end, at an unhurried reading pace.
 */

/** Silent reading of non-fiction, words per minute (Brysbaert 2019). */
export const WORDS_PER_MINUTE = 238;

export function wordCount(text: string): number {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

/** Whole minutes to read `words[index..]`, rounded up; 0 when nothing is left. */
export function minutesLeft(words: readonly number[], index: number): number {
  let total = 0;
  for (let i = Math.max(0, index); i < words.length; i += 1) total += words[i] ?? 0;
  return Math.ceil(total / WORDS_PER_MINUTE);
}

export function timeLeftLabel(minutes: number): string {
  if (minutes <= 0) return 'End of chapter';
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}

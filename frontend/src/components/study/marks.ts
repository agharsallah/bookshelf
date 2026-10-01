/**
 * Where flashcard marks live: the review queue (`/reviews/flashcards/{artifact}`), so a
 * card you marked comes back on Today when FSRS says it is due. Marks a browser kept
 * in localStorage, before they moved there, are sent up once and then forgotten locally.
 */
import { flashcardMarks, markFlashcard, type RecallApi } from '../recall/api';
import { marksKey, readMarks, type Marks } from './deck';

type LocalStorage = Pick<Storage, 'getItem' | 'removeItem'> | undefined;

export async function loadMarks(api: RecallApi, storage: LocalStorage, artifactId: string, cardCount: number): Promise<Marks> {
  const saved = await flashcardMarks(api, artifactId);
  const local = Object.entries(readMarks(storage, artifactId, cardCount)).filter(([card]) => !(Number(card) in saved));
  const moved = await Promise.all(
    local.map(async ([card, mark]) => {
      await markFlashcard(api, artifactId, Number(card), mark);
      return [Number(card), mark] as const;
    }),
  );
  try {
    storage?.removeItem(marksKey(artifactId));
  } catch {
    // Storage blocked: nothing was kept there either.
  }
  return { ...saved, ...Object.fromEntries(moved) };
}

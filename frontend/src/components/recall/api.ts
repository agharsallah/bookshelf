/**
 * Recall and review calls. Recalls and predictions are written once and never edited;
 * a recall comes back with the job that grades it. Reviews reveal their answer only for
 * what you typed, then take your rating.
 */
import type { ApiClient } from '../../lib/api/client';
import type {
  DueCards,
  FlashcardMark,
  FlashcardMarks,
  Rated,
  Rating,
  RecallCreated,
  RecallKind,
  RecallPublic,
  Revealed,
} from '../../lib/api/types/recalls';
import type { JobPublic } from '../../lib/api/types/jobs';

export type RecallApi = Pick<ApiClient, 'get' | 'post' | 'put' | 'delete'>;

const recallsPath = (slug: string) => `documents/${encodeURIComponent(slug)}/recalls`;

export function writeRecall(api: RecallApi, slug: string, unit: string, kind: RecallKind, raw: string): Promise<RecallCreated> {
  return api.post<RecallCreated>(recallsPath(slug), { unit, kind, raw });
}

export function listRecalls(api: RecallApi, slug: string, unit: string): Promise<RecallPublic[]> {
  return api.get<RecallPublic[]>(recallsPath(slug), { query: { unit } });
}

export function gradeAgain(api: RecallApi, slug: string, recallId: string): Promise<JobPublic> {
  return api.post<JobPublic>(`${recallsPath(slug)}/${recallId}/grade`);
}

export function dueCards(api: RecallApi, limit = 50): Promise<DueCards> {
  return api.get<DueCards>('reviews/due', { query: { limit } });
}

export function revealAnswer(api: RecallApi, id: string, answer: string): Promise<Revealed> {
  return api.post<Revealed>(`reviews/${id}/reveal`, { answer });
}

export function rateReview(api: RecallApi, id: string, rating: Rating, answer: string): Promise<Rated> {
  return api.post<Rated>(`reviews/${id}/rating`, { rating, answer });
}

export async function flashcardMarks(api: RecallApi, artifactId: string): Promise<Record<number, FlashcardMark>> {
  const { marks } = await api.get<FlashcardMarks>(`reviews/flashcards/${artifactId}`);
  return Object.fromEntries(Object.entries(marks).map(([i, m]) => [Number(i), m]));
}

export async function markFlashcard(api: RecallApi, artifactId: string, index: number, mark: FlashcardMark): Promise<void> {
  await api.put<FlashcardMarks>(`reviews/flashcards/${artifactId}/${index}`, { mark });
}

export async function forgetFlashcards(api: RecallApi, artifactId: string): Promise<void> {
  await api.delete<unknown>(`reviews/flashcards/${artifactId}`);
}

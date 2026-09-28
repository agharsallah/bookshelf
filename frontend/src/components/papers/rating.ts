/**
 * Your rating of a paper and your passes through it, as pure state (docs/PAPERS.md §6, P8).
 *
 * Ratings are append-only: saving writes a new rating that supersedes the last, so the
 * form starts from the latest stars and verdict with an empty note, and the history
 * keeps every earlier one. Passes are three steps you mark done or undo, in any order.
 */
import type { PaperPassPublic, PaperRatingCreate, PaperRatingPublic, PaperVerdict, PassNumber } from '../../lib/api/types/papers';
import { PASSES } from '../../lib/api/types/papers';
import { PASS_LABELS } from './labels';

export interface RatingState {
  stars: number | null;
  verdict: PaperVerdict | null;
  note: string;
  /** Newest first; `history[0]` is the rating in force. */
  history: PaperRatingPublic[];
}

export type RatingAction =
  | { type: 'stars'; stars: number }
  | { type: 'verdict'; verdict: PaperVerdict }
  | { type: 'note'; note: string }
  | { type: 'saved'; rating: PaperRatingPublic }
  | { type: 'reset' };

export function initialRating(history: readonly PaperRatingPublic[]): RatingState {
  const latest = history[0] ?? null;
  return { stars: latest?.stars ?? null, verdict: latest?.verdict ?? null, note: '', history: [...history] };
}

export function ratingReducer(state: RatingState, action: RatingAction): RatingState {
  switch (action.type) {
    case 'stars':
      return { ...state, stars: Math.min(5, Math.max(1, Math.round(action.stars))) };
    case 'verdict':
      // Choosing the verdict already chosen clears it: a verdict is optional.
      return { ...state, verdict: state.verdict === action.verdict ? null : action.verdict };
    case 'note':
      return { ...state, note: action.note };
    case 'saved':
      return { ...initialRating([action.rating, ...state.history]) };
    case 'reset':
      return initialRating(state.history);
  }
}

/** Whether the form says something the rating in force does not. */
export function isChanged(state: RatingState): boolean {
  const latest = state.history[0] ?? null;
  if (state.note.trim() !== '') return true;
  return state.stars !== (latest?.stars ?? null) || state.verdict !== (latest?.verdict ?? null);
}

/** Stars are required; nothing is saved that would repeat the rating in force. */
export function canSave(state: RatingState): boolean {
  return state.stars !== null && isChanged(state);
}

/** The `POST /papers/{ref}/ratings` body, or null when there is nothing to save. */
export function ratingBody(state: RatingState): PaperRatingCreate | null {
  if (!canSave(state) || state.stars === null) return null;
  const note = state.note.trim();
  return { stars: state.stars, verdict: state.verdict, ...(note ? { note } : {}) };
}

export interface PassStep {
  pass: PassNumber;
  name: string;
  hint: string;
  done: boolean;
  completedAt: string | null;
  note: string | null;
}

/** The three passes in order, each marked done from the completed ones. */
export function passSteps(passes: readonly PaperPassPublic[]): PassStep[] {
  return PASSES.map((pass) => {
    const found = passes.find((p) => p.pass === pass) ?? null;
    return { pass, ...PASS_LABELS[pass], done: found !== null, completedAt: found?.completed_at ?? null, note: found?.note ?? null };
  });
}

/** Passes after marking `pass` done (`done`) or undoing it, kept in pass order. */
export function withPass(passes: readonly PaperPassPublic[], pass: PassNumber, done: PaperPassPublic | null): PaperPassPublic[] {
  const rest = passes.filter((p) => p.pass !== pass);
  return (done ? [...rest, done] : rest).sort((a, b) => a.pass - b.pass);
}

/** The highest pass done, as the shelf filters by it; 0 before any. */
export function highestPass(passes: readonly Pick<PaperPassPublic, 'pass'>[]): 0 | PassNumber {
  return passes.reduce<0 | PassNumber>((max, p) => (p.pass > max ? p.pass : max), 0);
}

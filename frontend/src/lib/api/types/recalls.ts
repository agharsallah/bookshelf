/**
 * Remembering what you read (backend/app/schemas/recall.py, review.py). A recall is the
 * chapter written from memory, a prediction what you expected it to argue; both are your
 * words, never edited (D11). A grade is derived, by the grade-recall skill. Review cards
 * come back on an FSRS schedule; a due card carries its prompt only, the answer is
 * revealed for a typed attempt.
 */
import type { Anchor, Spans } from '../../contract';
import type { JobPublic } from './jobs';

export type RecallKind = 'recall' | 'prediction';
export type IdeaStatus = 'recalled' | 'partial' | 'missed';

/** One key idea of the chapter and how the recall did on it. */
export interface GradedIdea {
  id: string;
  tier: 'core' | 'key';
  text: string;
  why: string | null;
  cites: Anchor[];
  status: IdeaStatus;
  feedback: string;
  /** The retrieval question it comes back as (partial and missed ideas). */
  cue?: string;
}

export interface RecallGrade {
  ideas: GradedIdea[];
  /** One "why is this true?" about a recalled idea. */
  question: { idea: string; text: string; cites: Anchor[] } | null;
  /** The prediction written before reading, against what the chapter argues. */
  comparison: { predicted: string; argues: string; ideas: string[]; cites: Anchor[] } | null;
  prediction_id: string | null;
  origin: string;
  model: string | null;
  created_at: string;
}

export interface RecallPublic {
  id: string;
  unit: Anchor;
  kind: RecallKind;
  raw: string;
  created_at: string;
  grade: RecallGrade | null;
}

/** `POST /documents/{ref}/recalls`: `job` grades a recall; null for a prediction. */
export interface RecallCreated extends RecallPublic {
  job: JobPublic | null;
}

export type ReviewSource = 'recall' | 'question' | 'flashcard' | 'pill';

/** `GET /reviews/due`: a card waiting for you, prompt only. */
export interface DueCard {
  id: string;
  document: { id: string; slug: string; title: string };
  anchor: Anchor;
  source: ReviewSource;
  prompt: string;
  due: string;
}

export interface DueCards {
  items: DueCard[];
  /** Every card due, across all books. */
  total: number;
}

/** `POST /reviews/{id}/reveal`. */
export interface Revealed {
  id: string;
  anchor: Anchor;
  answer: Spans;
}

/** 1 again · 2 hard · 3 good · 4 easy. */
export type Rating = 1 | 2 | 3 | 4;

export interface Rated {
  id: string;
  due: string;
  last_rating: Rating;
}

export type FlashcardMark = 'knew' | 'learning';

/** `GET /reviews/flashcards/{artifact_id}`: card index → your last mark. */
export interface FlashcardMarks {
  marks: Record<string, FlashcardMark>;
}

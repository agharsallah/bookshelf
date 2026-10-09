/**
 * Artifact wire shapes (backend/app/schemas/artifact.py, app/models/enums.py).
 * An artifact is one version of one generated (or hand-written) output for a scope.
 */

export const ARTIFACT_TYPES = [
  'outline_override',
  'figure_description',
  'code_explanation',
  'math_description',
  'table_explanation',
  'chapter_summary',
  'book_summary',
  'section_note',
  'chapter_distillation',
  'book_brief',
  'book_guide',
  'structured_note',
  'concept_links',
  'quote_set',
  'faq',
  'quiz',
  'flashcards',
  'glossary',
  'audio_summary',
  'salience_marks',
  // Papers (docs/PAPERS.md §4)
  'paper_card',
  'paper_explainer',
  'claim_set',
  'results_table',
  'citation_intents',
  'paper_assessment',
  'paper_review',
  'notation_table',
  'journal_club',
  'math_explainer',
  // The library
  'catalogue_entry',
  // Pills (docs/PILLS.md §5)
  'pill_set',
] as const;
export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export const REVIEW_STATES = ['draft', 'needs_review', 'approved', 'rejected'] as const;
export type Review = (typeof REVIEW_STATES)[number];

export type Origin = 'human' | 'skill';
export type RunMode = 'batch' | 'interactive';

export const TIERS = ['explore', 'distil', 'reason'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * The gate record stored with every artifact (app/pipeline/gates.py `GateReport.as_json`).
 * Human-authored artifacts carry `grounding`/`compression` as null (D15 bypass).
 */
export interface ArtifactGates {
  grounding?: number | null;
  compression?: number | null;
  words?: number;
  /** e.g. `grounding_below_min`, `compression_low`, `low_confidence`, `duplicate_of:ch03/s02`. */
  flags?: string[];
  schema_retry?: boolean;
  /** Render-block shape fixes applied before the schema gate, e.g. `paragraph: text → spans`. */
  repairs?: string[];
}

export interface ArtifactPublic {
  id: string;
  document_id: string;
  anchor: string | null;
  note_id: string | null;
  /** The episode a parameterised run made (`15m-conversation-en`); null for other types. */
  variant?: string | null;
  type: ArtifactType;
  version: number;
  origin: Origin;
  skill: string | null;
  skill_version: string | null;
  model: string | null;
  run_mode: RunMode | null;
  tier: Tier | null;
  input_hash: string;
  /** Shape depends on `type`: `{blocks}` for most, `{sections}` for briefs, `{items}` for quiz/faq/flashcards… */
  body: Record<string, unknown>;
  citations: string[];
  gates: ArtifactGates;
  review: Review;
  reviewed_at: string | null;
  created_at: string;
}

/** `GET /artifacts` item: with `?tone=`, the matching callout blocks. */
export interface ArtifactListItem extends ArtifactPublic {
  matched_blocks?: Record<string, unknown>[] | null;
  /** A newer non-rejected version of this scope exists (e.g. a human edit). */
  superseded: boolean;
}

/** `POST /artifacts`: a human-authored artifact, approved on arrival. */
export interface ArtifactCreate {
  document_id: string;
  type: ArtifactType;
  anchor?: string | null;
  note_id?: string | null;
  body: Record<string, unknown>;
}

/** `reopen` returns an approved or rejected artifact to `draft` (409 if it cannot). */
export type ReviewAction = 'approve' | 'reject' | 'edit' | 'reopen';

/** `POST /artifacts/{id}/review`; `body` is required for `edit`. */
export interface ReviewRequest {
  action: ReviewAction;
  body?: Record<string, unknown>;
}

/** Query of `GET /artifacts`. */
export interface ArtifactQuery {
  document_id?: string;
  type?: ArtifactType;
  review?: Review;
  tone?: string;
  anchor_prefix?: string;
  /** Hide superseded rows. */
  latest?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Wire shapes of the claim tracker (backend/app/schemas/paper_claims.py, docs/PAPERS.md §5,
 * §7) and the vocabularies of the paper study artifacts (assessment, review, results…).
 * Kept apart from ./papers so the shelf shapes and these grow independently.
 */
import type { ClaimKind, ClaimStrength } from './papers';
import type { EdgeStatus, GraphDocument, Passage, Relation } from './graph';

/** A claim of a paper's approved claim_set (`claims` table). */
export interface ClaimPublic {
  id: string;
  document_id: string;
  artifact_id: string;
  /** `C1`, `C2`… within its claim set. */
  key: string;
  text: string;
  kind: ClaimKind;
  strength: ClaimStrength;
  /** Anchors the claim rests on. */
  evidence: string[];
  /** The unit (top-level section) of its first cite; null for an abstract-only claim. */
  unit: string | null;
}

/**
 * Accepted claim ↔ claim edges, read from this claim's side. `contradicted_by` counts a
 * `contradicts` either way; `proposed` counts relations still waiting for you.
 */
export interface ClaimRelationCounts {
  supported_by: number;
  contradicted_by: number;
  extended_by: number;
  supports: number;
  extends: number;
  proposed: number;
}

export interface ClaimWithRelations extends ClaimPublic {
  relations: ClaimRelationCounts;
}

export interface ClaimUnitGroup {
  /** null: claims of the abstract. */
  unit: string | null;
  heading: string | null;
  role: string | null;
  claims: ClaimWithRelations[];
}

/** `GET /papers/{ref}/claims`. */
export interface PaperClaims {
  document_id: string;
  /** The approved claim_set the rows come from; null before one is approved. */
  artifact_id: string | null;
  total: number;
  /** In reading order. */
  units: ClaimUnitGroup[];
}

/** One claim ↔ claim edge, read from the claim asked about. */
export interface ClaimRelation {
  edge_id: string;
  relation: Relation;
  /** `out`: this claim <relation> the other · `in`: the other <relation> this one. */
  direction: 'out' | 'in';
  status: EdgeStatus;
  weight: number;
  confidence: string | null;
  rationale: string | null;
  other: ClaimPublic;
  other_document: GraphDocument | null;
  /** Cited passages of both papers. */
  evidence: Passage[];
}

/** `GET /claims/{id}/relations`: accepted first, then proposed; rejected left out. */
export interface ClaimRelations {
  claim: ClaimPublic;
  document: GraphDocument | null;
  relations: ClaimRelation[];
}

export interface MarkedClaim {
  id: string;
  key: string;
  strength: ClaimStrength;
}

/** What the reader's margin shows next to one passage. */
export interface ClaimMark {
  anchor: string;
  claims: MarkedClaim[];
  supported_by: number;
  contradicted_by: number;
  extended_by: number;
}

/** `GET /documents/{ref}/claims/marks?unit=`. */
export interface ClaimMarks {
  document_id: string;
  unit: string | null;
  /** In reading order of the anchors. */
  marks: ClaimMark[];
}

/** `POST /papers/claims/relate?document=` (202). */
export interface RelateQueued {
  jobs: string[];
}

// ── Study artifact vocabularies (skills/<name>/schema.json) ─────────────────────────

export const REVIEW_SEVERITIES = ['major', 'minor'] as const;
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number];

export const RECOMMENDATIONS = ['accept', 'weak_accept', 'borderline', 'weak_reject', 'reject'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const REPRODUCIBILITY_ITEMS = [
  'code',
  'data',
  'hyperparameters',
  'seeds',
  'compute',
  'baselines',
  'ablations',
  'statistical_significance',
  'data_splits',
  'evaluation_protocol',
] as const;
export type ReproducibilityItem = (typeof REPRODUCIBILITY_ITEMS)[number];

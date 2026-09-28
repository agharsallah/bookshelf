/**
 * Papers wire shapes (backend/app/schemas/{papers,paper_shelf}.py, app/models/enums.py;
 * docs/PAPERS.md §2, §7). A paper is a document with `genre = 'paper'`; these are the
 * shelf rows, its metadata, your ratings and passes, its bibliography and the reading queue.
 */
import type { ArtifactType, Review } from './artifacts';
import type { DocumentStatus } from './documents';

export const PAPER_META_SOURCES = ['parsed', 'openalex', 'grobid', 'human'] as const;
export type PaperMetaSource = (typeof PAPER_META_SOURCES)[number];

export const CITATION_INTENTS = ['background', 'uses', 'extends', 'compares', 'contradicts'] as const;
export type CitationIntent = (typeof CITATION_INTENTS)[number];

export const CLAIM_KINDS = ['method', 'result', 'theory', 'dataset', 'benchmark', 'position'] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CLAIM_STRENGTHS = ['measured', 'argued', 'speculated'] as const;
export type ClaimStrength = (typeof CLAIM_STRENGTHS)[number];

export const PAPER_VERDICTS = ['must_read', 'useful', 'skim', 'skip'] as const;
export type PaperVerdict = (typeof PAPER_VERDICTS)[number];

export const CANDIDATE_STATUSES = ['suggested', 'queued', 'dismissed', 'ingested'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const CANDIDATE_SOURCES = ['reference', 'cited_by', 'related', 'similar', 'watch'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const SECTION_ROLES = [
  'abstract',
  'introduction',
  'related_work',
  'background',
  'method',
  'experiments',
  'results',
  'discussion',
  'limitations',
  'conclusion',
  'references',
  'appendix',
  'other',
] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

/** `simplify-paper` params.level; each level is its own `paper_explainer` variant. */
export const EXPLAINER_LEVELS = ['newcomer', 'practitioner', 'expert'] as const;
export type ExplainerLevel = (typeof EXPLAINER_LEVELS)[number];

export const ASSESSMENT_CRITERIA = ['novelty', 'rigour', 'evidence', 'clarity', 'reproducibility', 'relevance'] as const;
export type AssessmentCriterion = (typeof ASSESSMENT_CRITERIA)[number];

export const REPRODUCIBILITY_STATUSES = ['yes', 'partial', 'no', 'unknown'] as const;
export type ReproducibilityStatus = (typeof REPRODUCIBILITY_STATUSES)[number];

/** `GET /papers?sort=`. */
export const PAPER_SORTS = ['recent', 'title', 'year', 'stars', 'cited_by'] as const;
export type PaperSort = (typeof PAPER_SORTS)[number];

/** The three reading passes (docs/PAPERS.md §6). */
export const PASSES = [1, 2, 3] as const;
export type PassNumber = (typeof PASSES)[number];

export interface PaperRatingPublic {
  id: string;
  document_id: string;
  stars: number;
  verdict: PaperVerdict | null;
  note: string | null;
  created_at: string;
}

/** `POST /papers/{ref}/ratings`: a new rating supersedes; none is ever edited. */
export interface PaperRatingCreate {
  stars: number;
  verdict?: PaperVerdict | null;
  note?: string | null;
}

export interface PaperPassPublic {
  document_id: string;
  pass: PassNumber;
  completed_at: string;
  note: string | null;
}

/** The preferred artifact of one paper type and variant (latest approved, else latest draft). */
export interface PaperArtifactState {
  type: ArtifactType;
  /** e.g. the explainer level. */
  variant: string | null;
  artifact_id: string;
  review: Review;
  created_at: string;
}

export interface PaperCounts {
  references: number;
  references_on_shelf: number;
  claims: number;
}

/** `GET /papers` item. `year` is `paper_meta.year`, else the document's. */
export interface PaperSummary {
  id: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  status: DocumentStatus;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  cited_by_count: number | null;
  /** null: no `paper_meta` yet. */
  meta_source: PaperMetaSource | null;
  /** Your latest rating. */
  rating: PaperRatingPublic | null;
  /** 1–3; null before the first pass. */
  highest_pass: PassNumber | null;
  artifacts: PaperArtifactState[];
  counts: PaperCounts;
  created_at: string;
}

export interface PaperMetaPublic {
  document_id: string;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  venue: string | null;
  year: number | null;
  abstract: string | null;
  fields: string[];
  code_urls: string[];
  data_urls: string[];
  cited_by_count: number | null;
  reference_count: number | null;
  source: PaperMetaSource;
  enriched_at: string | null;
  updated_at: string;
}

/** `PATCH /papers/{ref}/meta`: only sent fields change; `null` clears one. */
export type PaperMetaUpdate = Partial<
  Pick<PaperMetaPublic, 'doi' | 'arxiv_id' | 'openalex_id' | 'venue' | 'year' | 'abstract' | 'fields' | 'code_urls' | 'data_urls'>
>;

/** `GET /papers/{ref}`. */
export interface PaperDetail extends PaperSummary {
  meta: PaperMetaPublic | null;
  /** Completed passes, pass 1 first. */
  passes: PaperPassPublic[];
}

export interface FacetCount<V extends string | number> {
  value: V;
  count: number;
}

/** Counts over the whole paper shelf (not the current filter). */
export interface PaperFacets {
  /** Most papers first. */
  venues: FacetCount<string>[];
  /** Newest first. */
  years: FacetCount<number>[];
}

/** `GET /papers`. */
export interface PaperPage {
  items: PaperSummary[];
  total: number;
  limit: number;
  offset: number;
  facets: PaperFacets;
}

/** Query of `GET /papers`. `pass`: 0 = no pass yet, n = the highest completed pass. */
export interface PaperQuery {
  q?: string;
  venue?: string;
  year?: number;
  min_stars?: number;
  pass?: 0 | PassNumber;
  verdict?: PaperVerdict;
  status?: DocumentStatus;
  sort?: PaperSort;
  limit?: number;
  offset?: number;
}

/** One bibliography entry (`GET /papers/{ref}/references`), ordered by `ordinal`. */
export interface PaperReferenceRow {
  id: string;
  document_id: string;
  ordinal: number;
  anchor: string | null;
  raw: string;
  title: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  target_document_id: string | null;
  /** Anchors of the in-text citations. */
  cited_at: string[];
  intent: CitationIntent | null;
  intent_cites: string[];
  /** The shelf document this entry is. */
  target: { id: string; slug: string; title: string } | null;
  /** The reading candidate this entry is (by OpenAlex id, DOI or arXiv id). */
  candidate: { id: string; status: CandidateStatus; score: number } | null;
}

export interface CandidateSourceRef {
  kind: CandidateSource;
  document_id: string | null;
}

/** `GET /papers/candidates` item. */
export interface ReadingCandidatePublic {
  id: string;
  openalex_id: string | null;
  doi: string | null;
  arxiv_id: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  pdf_url: string | null;
  cited_by_count: number | null;
  sources: CandidateSourceRef[];
  score: number;
  /** Each term of `score` (source, rating, shelf, intent, citations, recency, similarity). */
  score_parts: Record<string, number>;
  reason: string | null;
  /** `<document_id>#<anchor>` each. */
  reason_cites: string[];
  status: CandidateStatus;
  /** Set once it is on the shelf. */
  document_id: string | null;
  created_at: string;
  updated_at: string;
}

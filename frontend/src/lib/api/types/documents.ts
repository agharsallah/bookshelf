/**
 * Document, library and tree wire shapes (backend/app/schemas/{document,node}.py).
 * `ref` in paths is a document id or slug.
 */
import type { JobPublic, JobKind, JobState } from './jobs';

export type DocumentKind = 'pdf' | 'article';

/** Pipeline state machine (ARCHITECTURE.md §7). */
export const DOCUMENT_STATUSES = [
  'registered',
  'parsing',
  'parse_failed',
  'parsed',
  'needs_review',
  'enriching',
  'distilling',
  'distilled',
  'indexed',
  'linked',
  'deriving',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** `GET /library` item: a file under `library/` not ingested yet. */
export interface LibraryFile {
  path: string;
  size: number;
  modified_at: string;
  kind: DocumentKind;
  sha256: string;
  suggested_title: string;
  suggested_slug: string;
}

/** `POST /documents`: exactly one of `path` or `url`. */
export interface DocumentCreate {
  path?: string;
  url?: string;
  title?: string;
  authors?: string[];
  year?: number;
  tags?: string[];
}

/** `PATCH /documents/{ref}`: omitted fields are left alone; `year: null` clears it. */
export interface DocumentUpdate {
  title?: string;
  authors?: string[];
  year?: number | null;
  tags?: string[];
  language?: string;
}

export interface DocumentPublic {
  id: string;
  kind: DocumentKind;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  source_uri: string | null;
  source_path: string | null;
  sha256: string;
  page_count: number | null;
  language: string;
  status: DocumentStatus;
  parse_tier: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface DocumentCounts {
  chapters: number;
  blocks: number;
  figures: number;
  notes: number;
}

/** Artifacts by review state. */
export interface ArtifactCounts {
  draft: number;
  needs_review: number;
  approved: number;
  rejected: number;
}

export interface JobBrief {
  id: string;
  kind: JobKind;
  state: JobState;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

/** Why the run ceiling stopped spending model runs on a document (§14). */
export interface PausedState {
  reason: string;
  at: string;
  runs: number;
  limit: number;
}

/** `GET /documents` item. */
export interface DocumentSummary extends DocumentPublic {
  counts: DocumentCounts;
  artifacts: ArtifactCounts;
  latest_job: JobBrief | null;
  /** Card text (≤ 280 chars): book summary, else brief thesis, else first chapter summary. */
  blurb: string | null;
  /** Set when the run ceiling paused the document; `POST /documents/{ref}/resume` clears it. */
  paused: PausedState | null;
}

/** `GET /documents/{ref}`. */
export interface DocumentDetail extends DocumentSummary {
  outline_override: OutlineChapter[] | null;
  meta: Record<string, unknown>;
  /** Job count by kind, then by state. */
  jobs: Partial<Record<JobKind, Partial<Record<JobState, number>>>>;
}

/** `POST /documents/{ref}/resume`; without `max_runs` the document gets another full allowance. */
export interface ResumeRequest {
  max_runs?: number;
}

/** `200` body of `POST /documents/{ref}/resume`. */
export interface DocumentResumed {
  document: DocumentDetail;
  /** Jobs the ceiling had stopped, queued again. */
  requeued: JobPublic[];
}

/** `200` body of `POST /documents/{ref}/outline/confirm`: now `parsed`, plus the first jobs. */
export interface OutlineConfirmed {
  document: DocumentPublic;
  jobs: JobPublic[];
}

/** `202` body of `POST /documents` and `PATCH /documents/{ref}/outline`. */
export interface DocumentAccepted {
  document: DocumentPublic;
  job: JobPublic;
  deduplicated: boolean;
}

// ── Outline override (§8 manual fix-up) ────────────────────────────────────────

export interface OutlineSection {
  title: string;
  page_from: number;
}

/**
 * The parser's override shape (backend/app/schemas/outline.py). Without `page_to` a
 * chapter runs until the next one starts (or the document ends); `skip` keeps it
 * readable but out of distillation (front/back matter).
 */
export interface OutlineChapter {
  title: string;
  page_from: number;
  page_to?: number | null;
  skip?: boolean;
  sections: OutlineSection[];
}

/** `PATCH /documents/{ref}/outline`; `{chapters: []}` removes the override. */
export interface OutlineUpdate {
  chapters: OutlineChapter[];
}

// ── Tree and nodes ─────────────────────────────────────────────────────────────

export const CONTAINER_KINDS = ['part', 'chapter', 'section'] as const;
export const LEAF_KINDS = ['paragraph', 'list', 'table', 'figure', 'code', 'math', 'aside', 'quote'] as const;
export type ContainerKind = (typeof CONTAINER_KINDS)[number];
export type LeafKind = (typeof LEAF_KINDS)[number];
export type NodeKind = ContainerKind | LeafKind;

/** Kind-specific data parsed out of the source (see backend/app/pipeline/parse). */
export interface NodeMeta {
  /** Tables: header + body rows of plain cell strings. */
  table?: { header: string[]; rows: string[][] };
  caption?: string | null;
  /** Figures and display math: crop path relative to `/media/`. */
  image_path?: string;
  /** Lists. */
  items?: string[];
  ordered?: boolean;
  /** Code. */
  language?: string | null;
  /** Asides: "Key points", "Warning"… */
  label?: string | null;
  /** Front-matter chapter (`fm01`). */
  front_matter?: boolean;
  /** Containers not distilled (back matter, bibliography, index, or `skip` in an override). */
  skip?: boolean;
  [key: string]: unknown;
}

export interface NodePublic {
  id: string;
  anchor: string;
  kind: NodeKind;
  ordinal: number;
  depth: number;
  heading: string | null;
  text: string | null;
  page_from: number | null;
  page_to: number | null;
  meta: NodeMeta;
}

export interface TreeNode extends NodePublic {
  children: TreeNode[];
}

/** `GET /documents/{ref}/tree`. */
export interface DocumentTree {
  document_id: string;
  slug: string;
  depth: number | null;
  include_blocks: boolean;
  nodes: TreeNode[];
}

/** `GET /nodes/{ref}/{anchor}`: a leaf, or a container with its subtree (capped). */
export interface NodeSubtree {
  document_id: string;
  slug: string;
  node: TreeNode;
  truncated: boolean;
}

export function isContainer(kind: NodeKind): kind is ContainerKind {
  return (CONTAINER_KINDS as readonly string[]).includes(kind);
}

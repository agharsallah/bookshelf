/**
 * Shelf-level paper shapes (docs/PAPERS.md §5, §7): the results comparison
 * (backend/app/schemas/paper_compare.py) and paper sets with their syntheses
 * (backend/app/schemas/{papers,paper_sets}.py). Per-paper shapes live in `./papers`.
 */
import type { Review } from './artifacts';
import type { PaperSummary } from './papers';
import type { CiteSource } from './search';

/** A paper in a comparison, and how many result rows it gave. */
export interface ComparedPaper {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  /** The approved `results_table` read; null when the paper has none. */
  results_artifact_id: string | null;
  rows: number;
}

/** One (dataset, metric) column. */
export interface ResultColumn {
  /** `<dataset key>|<metric key>`. */
  key: string;
  dataset: string;
  metric: string;
  /** The column's most common unit; cells in another unit are not ranked. */
  unit: string | null;
  higher_is_better: boolean;
  /** Null with fewer than two comparable cells. */
  best: number | null;
  cells: number;
}

export interface ResultCell {
  /** A `ResultColumn.key`. */
  column: string;
  paper_id: string;
  value: number;
  unit: string | null;
  setting: string | null;
  /** The paper's own method (or a variant of it). */
  is_proposed: boolean;
  /** In the column's unit, so ranked. */
  comparable: boolean;
  best: boolean;
  /** Qualified `<document_id>#<anchor>`. */
  cites: string[];
}

/** One method: a concept's canonical name, or the first spelling seen. */
export interface ResultRow {
  key: string;
  method: string;
  cells: ResultCell[];
}

/** `GET /papers/compare?ids=`. */
export interface ResultsComparison {
  papers: ComparedPaper[];
  columns: ResultColumn[];
  rows: ResultRow[];
}

/** `POST /paper-sets`: papers only, order kept, duplicates dropped. */
export interface PaperSetCreate {
  name: string;
  document_ids: string[];
}

export interface PaperSetPublic {
  id: string;
  name: string;
  document_ids: string[];
  created_at: string;
}

export interface SynthesisSummary {
  id: string;
  version: number;
  review: Review;
  created_at: string;
}

/** `GET /paper-sets/{id}`: members as shelf rows, in set order. */
export interface PaperSetDetail extends PaperSetPublic {
  members: PaperSummary[];
  /** The latest approved synthesis, else the latest draft; null if none. */
  synthesis: SynthesisSummary | null;
}

/** A synthesis body: render-contract blocks and one at-a-glance table block. */
export interface SynthesisBody {
  blocks?: unknown[];
  table?: unknown;
}

/** `GET /paper-sets/{id}/synthesis?version=`; cites are `<slug>:<anchor>` keys of `sources`. */
export interface PaperSynthesisDetail {
  id: string;
  set_id: string;
  version: number;
  body: SynthesisBody;
  citations: string[];
  origin: string;
  model: string | null;
  input_hash: string;
  review: Review;
  created_at: string;
  sources: Record<string, CiteSource>;
}

export type SynthesisVerdict = 'approve' | 'reject';

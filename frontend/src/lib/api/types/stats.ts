/** Pipeline statistics wire shapes (backend/app/schemas/stats.py). Durations are ms. */
import type { DocumentKind, DocumentStatus } from './documents';
import type { JobKind } from './jobs';

export interface JobCounts {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  queued: number;
  running: number;
}

/** `tokens` is input + output for every job; the rest only cover recorded calls. */
export interface TokenTotals {
  tokens: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | null;
  wasted_tokens: number | null;
  tracked_calls: number;
}

export interface DurationStats {
  count: number;
  total_ms: number;
  mean_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
}

export interface BookInfo {
  id: string;
  slug: string;
  title: string;
  authors: string[];
  year: number | null;
  kind: DocumentKind;
  status: DocumentStatus;
  language: string;
  parse_tier: number | null;
  pages: number | null;
  chapters: number;
  sections: number;
  blocks: number;
  words: number;
  elements: Record<string, number>;
  created_at: string;
}

export interface TimeTotals {
  wall_ms: number;
  active_ms: number;
  compute_ms: number;
  model_ms: number | null;
  parallelism: number | null;
  wait: DurationStats;
}

export interface Efficiency {
  tokens_per_page: number | null;
  tokens_per_1k_words: number | null;
  seconds_per_page: number | null;
  minutes_per_10k_words: number | null;
  cost_per_page_usd: number | null;
}

export interface StageSpan {
  kind: JobKind;
  jobs: JobCounts;
  started_at: string | null;
  finished_at: string | null;
  start_offset_ms: number | null;
  end_offset_ms: number | null;
  span_ms: number | null;
  /** Time at least one of the stage's jobs was running. */
  busy_ms: number;
  /** When it ran, as [start, end] ms from the pass start (pass stages only). */
  segments: [number, number][];
  compute_ms: number;
  duration: DurationStats;
  tokens: number;
}

export interface PipelinePass {
  index: number;
  started_at: string;
  finished_at: string;
  wall_ms: number;
  active_ms: number;
  compute_ms: number;
  jobs: number;
  tokens: number;
  includes_parse: boolean;
  stages: StageSpan[];
}

export interface ChapterStats {
  anchor: string;
  title: string | null;
  ordinal: number;
  page_from: number | null;
  page_to: number | null;
  pages: number | null;
  words: number;
  sections: number;
  elements: number;
  jobs: JobCounts;
  calls: number;
  tokens: number;
  compute_ms: number;
  ms_by_kind: Partial<Record<JobKind, number>>;
  tokens_per_1k_words: number | null;
  seconds_per_page: number | null;
  grounding: number | null;
  needs_review: number;
  compression: number | null;
  words_out: number;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface SkillStats {
  skill: string;
  versions: string[];
  tiers: string[];
  models: string[];
  jobs: JobCounts;
  calls: number;
  tokens: TokenTotals;
  duration: DurationStats;
  tokens_per_job: number | null;
  failure_rate: number | null;
  cache_hit_rate: number | null;
  schema_retry_rate: number | null;
  repair_rate: number | null;
  needs_review_rate: number | null;
  grounding_mean: number | null;
  grounding_min: number | null;
  words_out_mean: number | null;
  tokens_per_output_word: number | null;
  prompt_chars_mean: number | null;
  artifacts: number;
  flags: NamedCount[];
  errors: NamedCount[];
}

export interface ModelStats {
  model: string;
  tiers: string[];
  calls: number;
  tokens: number;
  cost_usd: number | null;
  duration: DurationStats;
}

export interface Remaining {
  queued: number;
  running: number;
  eta_ms: number | null;
}

export type Severity = 'high' | 'medium' | 'info';
export type InsightArea = 'cost' | 'speed' | 'reliability' | 'quality' | 'throughput' | 'telemetry';

export interface Insight {
  severity: Severity;
  area: InsightArea;
  subject: string;
  title: string;
  detail: string;
  metric: string;
  value: number;
  threshold: number | null;
}

/** GET /documents/{ref}/stats */
export interface DocumentStats {
  book: BookInfo;
  jobs: JobCounts;
  tokens: TokenTotals;
  time: TimeTotals;
  efficiency: Efficiency;
  end_to_end: PipelinePass | null;
  passes: PipelinePass[];
  stages: StageSpan[];
  chapters: ChapterStats[];
  skills: SkillStats[];
  models: ModelStats[];
  remaining: Remaining;
  insights: Insight[];
  telemetry_since: string | null;
  generated_at: string;
}

/** One calendar day (UTC) of pipeline work: jobs count on the day they finished. */
export interface ActivityDay {
  /** `YYYY-MM-DD` */
  day: string;
  jobs: number;
  failed: number;
  compute_ms: number;
  /** The part of `compute_ms` spent on jobs that failed. */
  failed_ms: number;
  tokens: number;
  cost_usd: number | null;
  books: number;
}

export interface BookRow {
  book: BookInfo;
  jobs: JobCounts;
  tokens: TokenTotals;
  time: TimeTotals;
  efficiency: Efficiency;
  end_to_end_ms: number | null;
  failure_rate: number | null;
  remaining: Remaining;
  last_activity: string | null;
}

/** GET /stats */
export interface LibraryStats {
  books: BookRow[];
  jobs: JobCounts;
  tokens: TokenTotals;
  time: TimeTotals;
  skills: SkillStats[];
  models: ModelStats[];
  /** Every job kind across the library, in pipeline order. */
  stages: StageSpan[];
  /** Days with pipeline work, oldest first. */
  activity: ActivityDay[];
  insights: Insight[];
  telemetry_since: string | null;
  generated_at: string;
}

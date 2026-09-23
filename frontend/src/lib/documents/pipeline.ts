/**
 * The document state machine (§7) folded onto the five milestones a reader cares
 * about: registered → parsed → distilled → indexed → linked. Intermediate states
 * (parsing, enriching, distilling, deriving) mean "working towards the next one";
 * `parse_failed` and `needs_review` ask for attention at a milestone.
 */
import type { DocumentStatus } from '../api/types/documents';

export const PIPELINE_STEPS = [
  { key: 'registered', label: 'Registered' },
  { key: 'parsed', label: 'Parsed' },
  { key: 'distilled', label: 'Distilled' },
  { key: 'indexed', label: 'Indexed' },
  { key: 'linked', label: 'Linked' },
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number]['key'];

export interface PipelineProgress {
  /** Index into PIPELINE_STEPS of the last milestone reached. */
  reached: number;
  /** True while a job is moving the document towards the next milestone. */
  working: boolean;
  attention: 'failed' | 'review' | null;
  /** One short phrase for the current state, in the reader's words. */
  label: string;
}

const PROGRESS: Record<DocumentStatus, PipelineProgress> = {
  registered: { reached: 0, working: false, attention: null, label: 'Waiting to be parsed' },
  parsing: { reached: 0, working: true, attention: null, label: 'Parsing' },
  parse_failed: { reached: 0, working: false, attention: 'failed', label: 'Parsing failed' },
  parsed: { reached: 1, working: false, attention: null, label: 'Parsed, ready to read' },
  needs_review: { reached: 1, working: false, attention: 'review', label: 'Needs your review' },
  enriching: { reached: 1, working: true, attention: null, label: 'Describing figures and summarising' },
  distilling: { reached: 1, working: true, attention: null, label: 'Distilling' },
  distilled: { reached: 2, working: false, attention: null, label: 'Distilled' },
  indexed: { reached: 3, working: false, attention: null, label: 'Searchable' },
  linked: { reached: 4, working: false, attention: null, label: 'Linked to the shelf' },
  deriving: { reached: 4, working: true, attention: null, label: 'Making study material' },
};

export function pipelineProgress(status: DocumentStatus): PipelineProgress {
  return PROGRESS[status] ?? PROGRESS.registered;
}

/** How far along the pipeline the document is, 0–1, counting a working step as half done. */
export function pipelineFraction(status: DocumentStatus): number {
  const { reached, working } = pipelineProgress(status);
  const last = PIPELINE_STEPS.length - 1;
  return Math.min(1, (reached + (working ? 0.5 : 0)) / last);
}

/** The state of one milestone for a given document status. */
export function stepState(
  status: DocumentStatus,
  index: number,
): 'done' | 'current' | 'working' | 'failed' | 'review' | 'todo' {
  const { reached, working, attention } = pipelineProgress(status);
  if (index < reached) return 'done';
  // A failure belongs to the step that was being attempted, a review to the one reached.
  if (index === reached) return attention === 'review' ? 'review' : 'current';
  if (index === reached + 1 && working) return 'working';
  if (index === reached + 1 && attention === 'failed') return 'failed';
  return 'todo';
}

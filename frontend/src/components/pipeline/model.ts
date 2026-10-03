/**
 * Pipeline view model (§7): per-document progress through the stages, tallies by state
 * and kind, elapsed times. Pure; the view only draws it.
 */
import type { JobKind, JobPublic, JobState } from '../../lib/api/types/jobs';

// Moved to lib/jobs/progress (shared with the document page); re-exported for this view.
export { elapsedMs, formatDuration } from '../../lib/jobs/progress';

export interface Stage {
  key: string;
  label: string;
  kinds: readonly JobKind[];
  /** Document statuses (§7 state machine) meaning this stage is finished. */
  doneAt: readonly string[];
}

const AFTER_BRIEF = ['distilled', 'indexed', 'linked', 'deriving'];

export const STAGES: readonly Stage[] = [
  { key: 'parse', label: 'Parse', kinds: ['parse'], doneAt: ['parsed', 'needs_review', 'enriching', 'distilling', ...AFTER_BRIEF] },
  {
    key: 'enrich',
    label: 'Enrich',
    kinds: ['describe_figure', 'explain_code', 'describe_math', 'explain_table', 'summarize'],
    doneAt: ['distilling', ...AFTER_BRIEF],
  },
  { key: 'distil', label: 'Distil', kinds: ['distil_section', 'distil_chapter'], doneAt: AFTER_BRIEF },
  { key: 'brief', label: 'Brief', kinds: ['brief'], doneAt: AFTER_BRIEF },
  { key: 'index', label: 'Index', kinds: ['embed'], doneAt: ['indexed', 'linked', 'deriving'] },
  { key: 'link', label: 'Link', kinds: ['link_concepts'], doneAt: ['linked', 'deriving'] },
  { key: 'derive', label: 'Derive', kinds: ['derive'], doneAt: [] },
];

export type StageState = 'waiting' | 'active' | 'done' | 'failed';

export type StateCounts = Record<JobState, number>;

export interface StageProgress {
  stage: Stage;
  state: StageState;
  counts: StateCounts;
}

const zero = (): StateCounts => ({ queued: 0, running: 0, done: 0, failed: 0, skipped: 0 });

export function countStates(jobs: readonly JobPublic[]): StateCounts {
  const counts = zero();
  for (const job of jobs) counts[job.state] += 1;
  return counts;
}

export function countKinds(jobs: readonly JobPublic[]): Partial<Record<JobKind, number>> {
  const counts: Partial<Record<JobKind, number>> = {};
  for (const job of jobs) counts[job.kind] = (counts[job.kind] ?? 0) + 1;
  return counts;
}

/** Per kind, how many jobs sit in each state (the "By kind" bars). */
export function countKindStates(jobs: readonly JobPublic[]): Partial<Record<JobKind, StateCounts>> {
  const counts: Partial<Record<JobKind, StateCounts>> = {};
  for (const job of jobs) (counts[job.kind] ??= zero())[job.state] += 1;
  return counts;
}

/** Total jobs in a tally. */
export const totalOf = (counts: StateCounts): number => Object.values(counts).reduce((a, b) => a + b, 0);

/**
 * One document's stages. Live work makes a stage active; a failure with nothing live
 * marks it failed; the document status (or all jobs finished) marks it done.
 */
export function stageProgress(status: string, jobs: readonly JobPublic[]): StageProgress[] {
  return STAGES.map((stage) => {
    const counts = countStates(jobs.filter((j) => stage.kinds.includes(j.kind)));
    const live = counts.queued + counts.running;
    const finished = counts.done + counts.skipped;
    let state: StageState = 'waiting';
    if (live > 0) state = 'active';
    else if (stage.key === 'parse' && status === 'parse_failed') state = 'failed';
    else if (counts.failed > 0) state = 'failed';
    else if (stage.doneAt.includes(status) || finished > 0) state = 'done';
    return { stage, state, counts };
  });
}

export const KIND_LABELS: Record<JobKind, string> = {
  parse: 'Parse',
  describe_figure: 'Describe figure',
  explain_code: 'Explain code',
  describe_math: 'Describe formula',
  explain_table: 'Explain table',
  summarize: 'Summarize',
  distil_section: 'Distil section',
  distil_chapter: 'Distil chapter',
  brief: 'Write brief',
  structure_note: 'Structure note',
  embed: 'Embed',
  link_concepts: 'Link concepts',
  derive: 'Derive',
  export: 'Export',
  narrate: 'Record audio',
  grade_recall: 'Grade recall',
  distil_paper_section: 'Distil paper section',
  dissect_paper: 'Dissect paper',
  link_paper_concepts: 'Link paper concepts',
  paper_structure: 'Find paper structure',
  paper_enrich: 'Look up paper (OpenAlex)',
  paper_candidates: 'Find papers to read next',
  paper_watch: 'Check for new citing papers',
  paper_fetch: 'Download paper',
  relate_claims: 'Relate claims',
  recommend_next: 'Explain recommendations',
  synthesize_papers: 'Synthesize papers',
  build_plan: 'Plan a build',
  build_run: 'Build a repository',
};

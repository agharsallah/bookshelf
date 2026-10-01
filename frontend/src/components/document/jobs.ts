/**
 * Enqueueing work from the document and reader surfaces (`POST /jobs`), with the
 * wording the toast uses. Re-runs pass `force` so an existing artifact for the same
 * input does not short-circuit them; derived study material (`derive` + a skill from
 * `GET /skills`) does not, so asking twice for the same input costs nothing.
 */
import type { ApiClient } from '../../lib/api/client';
import type { JobAccepted, JobKind, JobPublic } from '../../lib/api/types/jobs';
import type { Genre } from '../../lib/api/types/documents';
import type { SkillPublic } from '../../lib/api/types/skills';
import { enqueueJob } from '../../lib/jobs/api';
import { problemOf } from '../common/Problem';
import { toast } from './toast';

export const JOB_LABELS: Partial<Record<JobKind, string>> = {
  parse: 'Re-parse',
  summarize: 'Summarize',
  distil_section: 'Distil section',
  distil_chapter: 'Distil chapter',
  brief: 'Write the brief',
  describe_figure: 'Describe figure',
  explain_table: 'Explain table',
  explain_code: 'Explain code',
  describe_math: 'Describe formula',
  export: 'Export',
  narrate: 'Record audio',
  grade_recall: 'Grade recall',
};

export function jobLabel(kind: JobKind): string {
  return JOB_LABELS[kind] ?? kind.replaceAll('_', ' ');
}

/** What a job is, for history lists ("Parse", "Distil chapter"), rather than a command. */
export function jobName(kind: JobKind): string {
  const name = kind === 'parse' ? 'Parse' : jobLabel(kind);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What each derive skill makes, as a command, by skill name (what a job records). */
const DERIVE_LABELS: Readonly<Record<string, string>> = {
  'make-quiz': 'Make a quiz',
  'make-faq': 'Write an FAQ',
  'extract-quotes': 'Pick quotes',
  'make-flashcards': 'Make flashcards',
  'make-glossary': 'Make a glossary',
  'write-guide': 'Write the book guide',
  'write-audio-summary': 'Make an audio summary',
  'mark-salience': 'Mark what matters',
  'simplify-paper': 'Explain the paper',
  'extract-claims': 'List the claims',
  'extract-results': 'Extract the results',
  'classify-citations': 'Classify the citations',
  'assess-paper': 'Assess the paper',
  'review-paper': 'Write a peer review',
  'make-notation': 'Make a notation table',
  'make-journal-club': 'Prepare a journal club',
  'explain-math': 'Explain the maths',
};

export function deriveLabel(skill: Pick<SkillPublic, 'name'>): string {
  return DERIVE_LABELS[skill.name] ?? skill.name;
}

/** What a job does, for lists: a derive job by its skill and where it runs, any other
 * by `name` (this module's `jobName` unless the surface has its own labels). */
export function jobTitle(job: Pick<JobPublic, 'kind' | 'skill' | 'anchor'>, name: (kind: JobKind) => string = jobName): string {
  if (job.kind !== 'derive' || !job.skill) return name(job.kind);
  return job.anchor ? deriveLabel({ name: job.skill }) : `${deriveLabel({ name: job.skill })} · whole book`;
}

export type DeriveScope = 'chapter' | 'document';

/** Whether a skill runs at `scope`: its own, or book-wide through its `document_selector`. */
function runsAt(skill: SkillPublic, scope: DeriveScope): boolean {
  return skill.scope === scope || (scope === 'document' && skill.document_selector !== null);
}

/** Whether a skill asks for choices before it runs (`params`): it is made on its own page
 * (the audio summary on the Listen page), not with a one-click button. */
export function takesChoices(skill: Pick<SkillPublic, 'params'>): boolean {
  return Object.keys(skill.params ?? {}).length > 0;
}

/** The derive skills written for papers (`genre: paper` in their meta.yaml, docs/PAPERS.md P2). */
const PAPER_SKILLS: ReadonlySet<string> = new Set([
  'simplify-paper',
  'extract-claims',
  'extract-results',
  'classify-citations',
  'assess-paper',
  'review-paper',
  'make-notation',
  'make-journal-club',
  'explain-math',
]);

/** Whether a skill suits a document of `genre`: a paper skill only a paper, the
 * genre-neutral ones (quiz, FAQ, glossary…) every genre (backend `app_settings.eligible`). */
export function suitsGenre(skill: Pick<SkillPublic, 'name'>, genre: Genre): boolean {
  return genre === 'paper' || !PAPER_SKILLS.has(skill.name);
}

/** The catalogue's one-click derive skills for one scope and genre, in a stable order. Book-wide,
 * that includes chapter skills (quiz, FAQ, quotes, flashcards) that can also run on the whole book. */
export function deriveSkills(skills: readonly SkillPublic[], scope: DeriveScope, genre: Genre): SkillPublic[] {
  return skills
    .filter((s) => s.job_kind === 'derive' && runsAt(s, scope) && suitsGenre(s, genre) && !takesChoices(s))
    .sort((a, b) => deriveLabel(a).localeCompare(deriveLabel(b)));
}

const DISTILLATION_SELECTORS = new Set(['chapter_distillation', 'document_chapters', 'document_distillations', 'document_quotes']);

/** Whether the skill's input at `scope` is built from chapter distillations, which must exist (approved) first. */
export function needsDistillation(skill: Pick<SkillPublic, 'selector' | 'document_selector'>, scope: DeriveScope = 'chapter'): boolean {
  const selector = scope === 'document' ? (skill.document_selector ?? skill.selector) : skill.selector;
  return DISTILLATION_SELECTORS.has(selector);
}

/** Key of the `made` maps (study material already made): skill and scope, `''` for the book. */
export function madeKey(skill: string, anchor: string | null): string {
  return `${skill}:${anchor ?? ''}`;
}

export interface EnqueueRequest {
  kind: JobKind;
  documentId: string;
  anchor?: string | null;
  force?: boolean;
  /** Required for `derive`: the skill to run. */
  skill?: SkillPublic;
}

/** Queue a job and say so; resolves to the job, or null when the request failed.
 * `quiet` skips the success toast, for callers that show the job's progress in place. */
export async function enqueue(
  api: Pick<ApiClient, 'post' | 'delete'>,
  request: EnqueueRequest,
  { quiet = false }: { quiet?: boolean } = {},
): Promise<JobAccepted | null> {
  // A derive with no anchor is book-wide study material; say so, as the chapter ones name theirs.
  const where = request.anchor ? ` for ${request.anchor}` : request.skill ? ' for the whole book' : '';
  const label = request.skill ? deriveLabel(request.skill) : jobLabel(request.kind);
  try {
    const accepted = await enqueueJob(api, {
      kind: request.kind,
      document_id: request.documentId,
      anchor: request.anchor ?? null,
      force: request.force ?? request.kind !== 'derive',
      ...(request.skill ? { skill: request.skill.name } : {}),
    });
    if (!quiet) toast(accepted.deduplicated ? `${label}${where}: already queued.` : `Queued: ${label.toLowerCase()}${where}.`, 'good');
    return accepted;
  } catch (error) {
    const problem = problemOf(error);
    toast(`Could not queue ${label.toLowerCase()}: ${problem.message}`, 'bad');
    return null;
  }
}

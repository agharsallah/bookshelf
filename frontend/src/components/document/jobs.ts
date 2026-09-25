/**
 * Enqueueing work from the document and reader surfaces (`POST /jobs`), with the
 * wording the toast uses. Re-runs pass `force` so an existing artifact for the same
 * input does not short-circuit them; derived study material (`derive` + a skill from
 * `GET /skills`) does not, so asking twice for the same input costs nothing.
 */
import type { ApiClient } from '../../lib/api/client';
import type { ArtifactType } from '../../lib/api/types/artifacts';
import type { JobAccepted, JobKind } from '../../lib/api/types/jobs';
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
};

export function jobLabel(kind: JobKind): string {
  return JOB_LABELS[kind] ?? kind.replaceAll('_', ' ');
}

/** What a job is, for history lists ("Parse", "Distil chapter"), rather than a command. */
export function jobName(kind: JobKind): string {
  const name = kind === 'parse' ? 'Parse' : jobLabel(kind);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** What each derive skill makes, as a command. */
const DERIVE_LABELS: Partial<Record<ArtifactType, string>> = {
  quiz: 'Make a quiz',
  faq: 'Write an FAQ',
  quote_set: 'Pick quotes',
  flashcards: 'Make flashcards',
  glossary: 'Make a glossary',
  book_guide: 'Write the book guide',
};

export function deriveLabel(skill: Pick<SkillPublic, 'name' | 'artifact_type'>): string {
  return (skill.artifact_type && DERIVE_LABELS[skill.artifact_type]) || skill.name;
}

/** The catalogue's derive skills for one scope (`chapter` or `document`), in a stable order. */
export function deriveSkills(skills: readonly SkillPublic[], scope: 'chapter' | 'document'): SkillPublic[] {
  return skills.filter((s) => s.job_kind === 'derive' && s.scope === scope).sort((a, b) => deriveLabel(a).localeCompare(deriveLabel(b)));
}

/** Skills whose input is the chapter distillation, which must exist (approved) first. */
export function needsDistillation(skill: Pick<SkillPublic, 'selector'>): boolean {
  return skill.selector === 'chapter_distillation' || skill.selector === 'document_chapters';
}

export interface EnqueueRequest {
  kind: JobKind;
  documentId: string;
  anchor?: string | null;
  force?: boolean;
  /** Required for `derive`: the skill to run. */
  skill?: SkillPublic;
}

/** Queue a job and say so; resolves to the job, or null when the request failed. */
export async function enqueue(api: Pick<ApiClient, 'post' | 'delete'>, request: EnqueueRequest): Promise<JobAccepted | null> {
  const where = request.anchor ? ` for ${request.anchor}` : '';
  const label = request.skill ? deriveLabel(request.skill) : jobLabel(request.kind);
  try {
    const accepted = await enqueueJob(api, {
      kind: request.kind,
      document_id: request.documentId,
      anchor: request.anchor ?? null,
      force: request.force ?? request.kind !== 'derive',
      ...(request.skill ? { skill: request.skill.name } : {}),
    });
    toast(accepted.deduplicated ? `${label}${where}: already queued.` : `Queued: ${label.toLowerCase()}${where}.`, 'good');
    return accepted;
  } catch (error) {
    const problem = problemOf(error);
    toast(`Could not queue ${label.toLowerCase()}: ${problem.message}`, 'bad');
    return null;
  }
}

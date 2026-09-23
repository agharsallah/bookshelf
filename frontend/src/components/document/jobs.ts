/**
 * Enqueueing work from the document and reader surfaces (`POST /jobs`), with the
 * wording the toast uses. Re-runs pass `force` so an existing artifact for the same
 * input does not short-circuit them.
 */
import type { ApiClient } from '../../lib/api/client';
import type { JobAccepted, JobKind } from '../../lib/api/types/jobs';
import { problemOf } from './Problem';
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

export interface EnqueueRequest {
  kind: JobKind;
  documentId: string;
  anchor?: string | null;
  force?: boolean;
}

/** Queue a job and say so; resolves to the job, or null when the request failed. */
export async function enqueue(api: Pick<ApiClient, 'post'>, request: EnqueueRequest): Promise<JobAccepted | null> {
  const where = request.anchor ? ` for ${request.anchor}` : '';
  try {
    const accepted = await api.post<JobAccepted>('jobs', {
      kind: request.kind,
      document_id: request.documentId,
      anchor: request.anchor ?? null,
      force: request.force ?? true,
    });
    toast(
      accepted.deduplicated
        ? `${jobLabel(request.kind)}${where} is already queued.`
        : `Queued: ${jobLabel(request.kind).toLowerCase()}${where}.`,
      'good',
    );
    return accepted;
  } catch (error) {
    const problem = problemOf(error);
    toast(`Could not queue ${jobLabel(request.kind).toLowerCase()}: ${problem.message}`, 'bad');
    return null;
  }
}

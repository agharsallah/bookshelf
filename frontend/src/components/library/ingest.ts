/**
 * Ingest outcomes. `POST /documents` answers 202 with the document and its parse job,
 * or 409 when the same content is already on the shelf (details carry the existing
 * document's id and slug).
 */
import type { ApiClient } from '../../lib/api/client';
import { ApiError } from '../../lib/api/errors';
import type { DocumentAccepted, DocumentCreate } from '../../lib/api/types/documents';
import type { JobPublic } from '../../lib/api/types/jobs';
import { problemOf, type ProblemInfo } from '../common/Problem';

export type IngestOutcome =
  | { kind: 'accepted'; slug: string; title: string; jobId: string; job: JobPublic }
  | { kind: 'duplicate'; slug: string | null; message: string }
  | { kind: 'failed'; problem: ProblemInfo };

export async function ingest(api: Pick<ApiClient, 'post'>, body: DocumentCreate): Promise<IngestOutcome> {
  try {
    const accepted = await api.post<DocumentAccepted>('documents', body);
    return {
      kind: 'accepted',
      slug: accepted.document.slug,
      title: accepted.document.title,
      jobId: accepted.job.id,
      job: accepted.job,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      const slug = error.details.map((d) => d.slug).find((s): s is string => typeof s === 'string') ?? null;
      return { kind: 'duplicate', slug, message: error.message };
    }
    return { kind: 'failed', problem: problemOf(error) };
  }
}

/** What to tell the reader about a parse job, in their words. */
export function jobPhrase(state: JobPublic['state'] | undefined): string {
  switch (state) {
    case 'running':
      return 'Parsing';
    case 'done':
      return 'On the shelf';
    case 'failed':
      return 'Parsing failed';
    case 'skipped':
      return 'Already up to date';
    default:
      return 'Waiting for the worker';
  }
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

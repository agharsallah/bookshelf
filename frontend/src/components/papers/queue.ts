/**
 * Which job answers a "make it" request on the paper tabs: the same kind, skill and
 * params (an explainer level) on the same document. Used to show a job already under
 * way instead of a button that would only be deduplicated.
 */
import type { JobCreate, JobPublic } from '../../lib/api/types/jobs';

function sameParams(asked: JobCreate['params'], payload: JobPublic['payload']): boolean {
  const given = payload?.params;
  const have = typeof given === 'object' && given !== null ? (given as Record<string, unknown>) : {};
  return Object.entries(asked ?? {}).every(([key, value]) => String(have[key]) === String(value));
}

export function jobMatches(job: JobPublic, request: JobCreate): boolean {
  return (
    job.kind === request.kind &&
    job.document_id === (request.document_id ?? null) &&
    (request.skill ? job.skill === request.skill : true) &&
    sameParams(request.params, job.payload)
  );
}

/** The newest job for `request` that is still queued or running, if any. */
export function liveJobFor(jobs: readonly JobPublic[], request: JobCreate): JobPublic | null {
  return (
    jobs
      .filter((j) => (j.state === 'queued' || j.state === 'running') && jobMatches(j, request))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}

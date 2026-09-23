/**
 * Job and pipeline control (`POST /jobs`, `DELETE /jobs/{id}`, `POST /jobs/{id}/retry`,
 * `POST /documents/{ref}/resume`), through an injected client so islands stay testable.
 */
import type { ApiClient } from '../api/client';
import type { DocumentResumed, ResumeRequest } from '../api/types/documents';
import type { JobAccepted, JobCreate, JobPublic } from '../api/types/jobs';

type Api = Pick<ApiClient, 'post' | 'delete'>;

export function enqueueJob(api: Api, request: JobCreate): Promise<JobAccepted> {
  return api.post<JobAccepted>('jobs', request);
}

/** A queued job becomes `skipped` ("cancelled by user"); `409` once it runs or finished. */
export function cancelJob(api: Api, id: string): Promise<JobPublic> {
  return api.delete<JobPublic>(`jobs/${id}`);
}

/** Queue a failed job's work again (without `force`); `409` unless it failed. */
export function retryJob(api: Api, id: string): Promise<JobAccepted> {
  return api.post<JobAccepted>(`jobs/${id}/retry`);
}

/** Lift a run-ceiling pause; the jobs the ceiling stopped are queued again. */
export function resumeDocument(api: Api, ref: string, request: ResumeRequest = {}): Promise<DocumentResumed> {
  return api.post<DocumentResumed>(`documents/${encodeURIComponent(ref)}/resume`, request);
}

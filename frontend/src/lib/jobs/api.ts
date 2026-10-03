/**
 * Job and pipeline control (`POST /jobs`, `DELETE /jobs/{id}`, `POST /jobs/{id}/retry`,
 * `POST /jobs/{id}/run-now`, `GET /jobs/{id}/runs`,
 * `POST /documents/{ref}/resume`, `PATCH /jobs/queue`), through an injected client so
 * islands stay testable.
 */
import type { ApiClient } from '../api/client';
import type { DocumentResumed, ResumeRequest } from '../api/types/documents';
import type { JobAccepted, JobCreate, JobPublic, ModelRunPublic, QueueControlsUpdate, QueueStatus } from '../api/types/jobs';

type Api = Pick<ApiClient, 'post' | 'delete'>;

export function enqueueJob(api: Api, request: JobCreate): Promise<JobAccepted> {
  return api.post<JobAccepted>('jobs', request);
}

/** A queued job becomes `skipped` ("cancelled by user"); `409` once it runs or finished. */
export function cancelJob(api: Api, id: string): Promise<JobPublic> {
  return api.delete<JobPublic>(`jobs/${id}`);
}

/** Send a queued job to the front: next free slot under the cap, even while paused. */
export function runJobNow(api: Api, id: string): Promise<JobPublic> {
  return api.post<JobPublic>(`jobs/${id}/run-now`);
}

/** A job's run log: every model call over all its attempts, oldest first. */
export function loadJobRuns(api: Pick<ApiClient, 'get'>, id: string): Promise<ModelRunPublic[]> {
  return api.get<ModelRunPublic[]>(`jobs/${id}/runs`);
}

/** Queue a failed job's work again (without `force`); `409` unless it failed. */
export function retryJob(api: Api, id: string): Promise<JobAccepted> {
  return api.post<JobAccepted>(`jobs/${id}/retry`);
}

/** Lift a run-ceiling pause; the jobs the ceiling stopped are queued again. */
export function resumeDocument(api: Api, ref: string, request: ResumeRequest = {}): Promise<DocumentResumed> {
  return api.post<DocumentResumed>(`documents/${encodeURIComponent(ref)}/resume`, request);
}

/** Pause or resume every worker, or cap how many jobs run at once; answers the new status. */
export function setQueueControls(api: Pick<ApiClient, 'patch'>, update: QueueControlsUpdate): Promise<QueueStatus> {
  return api.patch<QueueStatus>('jobs/queue', update);
}

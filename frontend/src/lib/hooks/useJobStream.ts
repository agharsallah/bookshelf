/**
 * `useJobStream` — live job changes from `GET /jobs/stream` (SSE) through the same-origin
 * proxy. Each island that needs live progress calls it (D10: islands own their state).
 *
 *   const { jobs, status } = useJobStream({ documentId });
 *
 * `seed` pre-fills jobs the island already knows (e.g. the one `POST /documents` just
 * returned) so they render before the first event arrives. Pass `enabled: false` to
 * hold the connection until there is something to watch. Islands on one page share a
 * single connection (../jobs/shared.ts), which reconnects with backoff when the stream
 * ends or fails (../jobs/connection.ts). `queue` is the queue's health: whether any
 * worker will pick the jobs up.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { browserApi } from '../api/client';
import type { JobPublic } from '../api/types/jobs';
import { subscribeJobStream } from '../jobs/shared';
import { initialJobStreamState, jobStreamReducer, type JobStreamState } from '../jobs/stream';

export interface UseJobStreamOptions {
  documentId?: string | null | undefined;
  enabled?: boolean;
  /** Jobs known before the stream opens; merged through the same reducer. */
  seed?: readonly JobPublic[];
}

export const JOB_STREAM_PATH = 'jobs/stream';

function seeded(seed: readonly JobPublic[] | undefined): JobStreamState {
  return (seed ?? []).reduce(
    (state, job) => jobStreamReducer(state, { type: 'job', job }),
    initialJobStreamState,
  );
}

export function useJobStream({ documentId, enabled = true, seed }: UseJobStreamOptions = {}) {
  const [state, dispatch] = useReducer(jobStreamReducer, seed, seeded);

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    return subscribeJobStream(browserApi.url(JOB_STREAM_PATH, documentId ? { document_id: documentId } : undefined), {
      onJob: (job) => dispatch({ type: 'job', job }),
      onQueue: (queue) => dispatch({ type: 'queue', queue }),
      onStatus: (type) => dispatch({ type }),
    });
  }, [documentId, enabled]);

  const track = useCallback((job: JobPublic) => dispatch({ type: 'job', job }), []);

  return {
    status: state.status,
    jobs: state.jobs,
    queue: state.queue,
    /** Feed a job learnt elsewhere (a `POST` response) into the same state. */
    track,
  };
}

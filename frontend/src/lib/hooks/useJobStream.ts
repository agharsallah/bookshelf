/**
 * `useJobStream` — live job changes from `GET /jobs/stream` (SSE) through the same-origin
 * proxy. Each island that needs live progress calls it (D10: islands own their state).
 *
 *   const { jobs, status } = useJobStream({ documentId });
 *
 * `seed` pre-fills jobs the island already knows (e.g. the one `POST /documents` just
 * returned) so they render before the first event arrives. Pass `enabled: false` to
 * hold the connection until there is something to watch.
 */
import { useCallback, useEffect, useReducer } from 'react';
import { browserApi } from '../api/client';
import type { JobPublic } from '../api/types/jobs';
import {
  initialJobStreamState,
  jobStreamReducer,
  parseJobEvent,
  type JobStreamState,
} from '../jobs/stream';

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
    const source = new EventSource(
      browserApi.url(JOB_STREAM_PATH, documentId ? { document_id: documentId } : undefined),
    );
    const onJob = (event: MessageEvent<string>) => {
      const job = parseJobEvent(event.data);
      if (job) dispatch({ type: 'job', job });
    };
    source.addEventListener('open', () => dispatch({ type: 'open' }));
    source.addEventListener('error', () => dispatch({ type: 'error' }));
    source.addEventListener('end', () => dispatch({ type: 'end' }));
    source.addEventListener('job', onJob as EventListener);
    return () => source.close();
  }, [documentId, enabled]);

  const track = useCallback((job: JobPublic) => dispatch({ type: 'job', job }), []);

  return {
    status: state.status,
    jobs: state.jobs,
    /** Feed a job learnt elsewhere (a `POST` response) into the same state. */
    track,
  };
}

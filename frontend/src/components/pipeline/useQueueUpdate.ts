/** Send one `PATCH /jobs/queue` at a time, saying when it is in flight or why it failed. */
import { useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { QueueControlsUpdate, QueueStatus } from '../../lib/api/types/jobs';
import { setQueueControls } from '../../lib/jobs/api';
import { problemOf, type ProblemInfo } from '../common/Problem';

export function useQueueUpdate(api: Pick<ApiClient, 'patch'>, onChanged: (queue: QueueStatus) => void) {
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);

  const send = async (update: QueueControlsUpdate) => {
    setSending(true);
    setProblem(null);
    try {
      onChanged(await setQueueControls(api, update));
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSending(false);
    }
  };

  return { send, sending, problem };
}

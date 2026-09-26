/**
 * Live study-material jobs of one document, for `DeriveButton`s: the latest job per
 * (skill, scope), the queue's health, and a clock that ticks only while one is live.
 */
import { useCallback, useMemo } from 'react';
import type { JobPublic } from '../../lib/api/types/jobs';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { isFinished } from '../../lib/jobs/stream';
import { latestJob } from '../../lib/jobs/progress';
import { useNow } from '../pipeline/useNow';

export function useDeriveJobs(documentId: string, seed: readonly JobPublic[] = []) {
  const { jobs, queue, track } = useJobStream({ documentId, seed });
  const derive = useMemo(() => Object.values(jobs).filter((j) => j.kind === 'derive'), [jobs]);
  const now = useNow(derive.some((j) => !isFinished(j.state)));
  const jobFor = useCallback(
    (skill: string, anchor: string | null) => latestJob(jobs, (j) => j.kind === 'derive' && j.skill === skill && (j.anchor ?? null) === anchor),
    [jobs],
  );
  return { jobFor, queue, now, track };
}

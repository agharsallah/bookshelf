/**
 * A build's plan versions (`GET /builds/{id}/plans`), oldest first, loaded only while
 * `enabled` and loaded again whenever the build's current version or count moves: a replan
 * that finished, an edit saved, a version restored. A poll that changes nothing else does
 * not ask again. The last list stays shown while the next one loads.
 */
import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildPlanVersion, BuildPublic } from '../../lib/api/types/builds';
import { listPlanVersions } from '../../lib/builds/api';
import { problemOf, type ProblemInfo } from '../common/Problem';

export function usePlanVersions(api: Pick<ApiClient, 'get'>, build: Pick<BuildPublic, 'id' | 'plan_version' | 'plan_versions_count'>, enabled: boolean) {
  const [versions, setVersions] = useState<BuildPlanVersion[] | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const { id, plan_version: current, plan_versions_count: count } = build;

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setProblem(null);
    listPlanVersions(api, id).then(
      (list) => live && setVersions([...list].sort((a, b) => a.version - b.version)),
      (error: unknown) => live && setProblem(problemOf(error)),
    );
    return () => {
      live = false;
    };
  }, [api, id, current, count, enabled]);

  return { versions, problem };
}

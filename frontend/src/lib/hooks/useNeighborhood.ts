/**
 * `useNeighborhood` — `GET /graph/neighborhood` for one focus and view, keeping the
 * last good neighbourhood on screen while the next one loads (so a re-focus animates
 * from the old picture instead of flashing empty). Stale responses are aborted.
 *
 *   const { hood, answered, loading, problem, reload } = useNeighborhood(api, ref, view, initial);
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { problemOf, type ProblemInfo } from '../../components/common/Problem';
import type { ApiClient } from '../api/client';
import type { GraphRef, Neighborhood } from '../api/types/graph';

export interface NeighborhoodView {
  depth: 1 | 2;
  proposed: boolean;
}

export interface UseNeighborhood {
  hood: Neighborhood | null;
  /** The ref `hood` was fetched for (the server may answer with a survivor's ref). */
  answered: GraphRef | null;
  loading: boolean;
  problem: ProblemInfo | null;
  reload: () => void;
}

function keyOf(ref: GraphRef, view: NeighborhoodView): string {
  return `${ref}|${view.depth}|${view.proposed ? 1 : 0}`;
}

export function useNeighborhood(api: ApiClient, ref: GraphRef, view: NeighborhoodView, initial: Neighborhood | null = null): UseNeighborhood {
  const [hood, setHood] = useState<Neighborhood | null>(initial);
  const [answered, setAnswered] = useState<GraphRef | null>(initial ? ref : null);
  const [loading, setLoading] = useState(initial === null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [nonce, setNonce] = useState(0);
  // The server-rendered neighbourhood answers the first key; don't fetch it again.
  const skip = useRef(initial ? keyOf(ref, view) : null);

  const { depth, proposed } = view;
  useEffect(() => {
    const key = keyOf(ref, { depth, proposed });
    if (skip.current === key && nonce === 0) {
      skip.current = null;
      return;
    }
    skip.current = null;
    const controller = new AbortController();
    setLoading(true);
    api
      .get<Neighborhood>('graph/neighborhood', { query: { node: ref, depth, include_proposed: proposed }, signal: controller.signal })
      .then((next) => {
        setHood(next);
        setAnswered(ref);
        setProblem(null);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProblem(problemOf(error));
        setLoading(false);
      });
    return () => controller.abort();
  }, [api, ref, depth, proposed, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { hood, answered, loading, problem, reload };
}

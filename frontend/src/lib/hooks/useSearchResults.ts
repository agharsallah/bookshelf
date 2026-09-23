/**
 * `useSearchResults` — run `POST /search` for a request, cancelling the previous call
 * when a newer one starts, so the last query typed is the one shown.
 *
 *   const { response, loading, problem } = useSearchResults(api, request, delayMs);
 */
import { useEffect, useState } from 'react';
import { problemOf, type ProblemInfo } from '../../components/common/Problem';
import type { ApiClient } from '../api/client';
import type { SearchRequest, SearchResponse } from '../api/types/search';

export interface SearchResults {
  response: SearchResponse | null;
  /** The request the response answers (null before the first). */
  answered: SearchRequest | null;
  loading: boolean;
  problem: ProblemInfo | null;
}

const idle: SearchResults = { response: null, answered: null, loading: false, problem: null };

export function useSearchResults(api: ApiClient, request: SearchRequest | null, delayMs = 0): SearchResults {
  const [state, setState] = useState<SearchResults>(idle);
  const key = request ? JSON.stringify(request) : '';

  useEffect(() => {
    if (!key) {
      setState(idle);
      return;
    }
    const body = JSON.parse(key) as SearchRequest;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(() => {
      api
        .post<SearchResponse>('search', body, { signal: controller.signal })
        .then((response) => setState({ response, answered: body, loading: false, problem: null }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState((s) => ({ ...s, loading: false, problem: problemOf(error) }));
        });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, key, delayMs]);

  return state;
}

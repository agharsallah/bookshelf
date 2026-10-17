/**
 * How the backend held up while the server rendered one request. Page frontmatter reaches
 * the backend through `serverApi()` (lib/api/server.ts), whose fetch is `upstreamFetch`:
 *
 * - a GET that fails at the backend's door (a network error, 502, 503 or 504: a free
 *   instance waking up, a deploy switching over) is tried once more after a pause;
 * - any failure that remains is noted for the request being rendered, so the middleware
 *   can tell a page that shows a problem from one that rendered whole (`trackUpstream`).
 *   The demo serves such a page as 503, which no cache keeps (middleware.ts).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const RETRY_STATUSES = new Set([502, 503, 504]);
export const RETRY_DELAY_MS = 1000;

const requests = new AsyncLocalStorage<{ failed: boolean }>();

function noteFailure(): void {
  const state = requests.getStore();
  if (state) state.failed = true;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `fetch` with one retry of a GET that failed at the door, noting what still failed. */
export function upstreamFetch(base: typeof fetch = globalThis.fetch, delay = RETRY_DELAY_MS): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const attempt = () => base(input, init);
    let response: Response;
    try {
      response = await attempt();
      if (method === 'GET' && RETRY_STATUSES.has(response.status)) {
        await pause(delay);
        response = await attempt();
      }
    } catch (error) {
      if (method !== 'GET') {
        noteFailure();
        throw error;
      }
      await pause(delay);
      try {
        response = await attempt();
      } catch (again) {
        noteFailure();
        throw again;
      }
    }
    if (response.status >= 500) noteFailure();
    return response;
  };
}

/** Run one request's rendering, then say whether a backend call failed during it. */
export async function trackUpstream<T>(render: () => Promise<T>): Promise<{ result: T; failed: boolean }> {
  const state = { failed: false };
  const result = await requests.run(state, render);
  return { result, failed: state.failed };
}

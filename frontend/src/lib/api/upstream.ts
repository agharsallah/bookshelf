/**
 * How the backend held up while the server rendered one request. Page frontmatter reaches
 * the backend through `serverApi()` (lib/api/server.ts), whose fetch is `upstreamFetch`:
 *
 * - a GET that fails at the backend's door (a network error, 502, 503 or 504: a free
 *   instance waking up, a deploy switching over) is tried again after each pause of
 *   `delays`: once after a second by default, for ~35 s in the demo, whose free API takes
 *   about a minute to wake (`WAKE_DELAYS_MS`);
 * - any failure that remains is noted for the request being rendered, so the middleware
 *   can tell a page that shows a problem from one that rendered whole (`trackUpstream`).
 *   The demo serves such a page as 503, which no cache keeps (middleware.ts).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const RETRY_STATUSES = new Set([502, 503, 504]);
export const RETRY_DELAYS_MS = [1000];
/** Waiting out a sleeping free instance (it holds requests once it is starting). */
export const WAKE_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 12000];

const requests = new AsyncLocalStorage<{ failed: boolean }>();

function noteFailure(): void {
  const state = requests.getStore();
  if (state) state.failed = true;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** `fetch` that retries a GET which failed at the door, noting what still failed. */
export function upstreamFetch(base: typeof fetch = globalThis.fetch, delays: readonly number[] = RETRY_DELAYS_MS): typeof fetch {
  return async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const retries = method === 'GET' ? delays : [];
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= retries.length;
      try {
        const response = await base(input, init);
        if (last || !RETRY_STATUSES.has(response.status)) {
          if (response.status >= 500) noteFailure();
          return response;
        }
      } catch (error) {
        if (last || init?.signal?.aborted) {
          noteFailure();
          throw error;
        }
      }
      await pause(retries[attempt] ?? 0);
    }
  };
}

/** Run one request's rendering, then say whether a backend call failed during it. */
export async function trackUpstream<T>(render: () => Promise<T>): Promise<{ result: T; failed: boolean }> {
  const state = { failed: false };
  const result = await requests.run(state, render);
  return { result, failed: state.failed };
}

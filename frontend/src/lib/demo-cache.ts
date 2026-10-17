/**
 * The read-only demo's pages and API answers (docs/DEMO.md) are the same for every visitor
 * until the data is reloaded, while the free API renders some slowly (the map's atlas takes
 * ~20 s on its share of a CPU). So in the demo every read opts into route caching (on
 * Vercel, its CDN: `cacheVercel()` in astro.config.mjs): fresh for ten minutes, then served
 * stale for up to a week while one request renders it again. The short fresh window lets a
 * page rendered while the API was asleep heal itself; a new deployment starts empty.
 */

export const DEMO_CACHE = { maxAge: 600, swr: 7 * 24 * 3600 };

/** Whether a demo request may be cached: reads only, and never a live stream (SSE). */
export function demoCacheable(request: Request): boolean {
  if (request.method.toUpperCase() !== 'GET') return false;
  return !(request.headers.get('accept') ?? '').includes('text/event-stream');
}

/**
 * The read-only demo's pages and API answers (docs/DEMO.md) are the same for every visitor
 * until the data is reloaded, while the free API renders some slowly (the map's atlas takes
 * ~20 s on its share of a CPU). So Vercel's CDN keeps every successful read: fresh for a
 * day, then served stale for up to a week while one request renders it again. A new
 * deployment starts with an empty cache, so redeploy after reloading the demo data.
 *
 * `CDN-Cache-Control` is read by the CDN only; browsers keep following `Cache-Control`.
 */

export const DEMO_CDN_CACHE_CONTROL = 'public, s-maxage=86400, stale-while-revalidate=604800';

/** The `CDN-Cache-Control` for a demo response, or null to leave it uncached. */
export function demoCdnCacheControl(method: string, response: Response): string | null {
  if (method.toUpperCase() !== 'GET' || response.status !== 200) return null;
  if (response.headers.has('set-cookie')) return null;
  // Streams (job progress, SSE) are live by nature.
  if ((response.headers.get('content-type') ?? '').startsWith('text/event-stream')) return null;
  return DEMO_CDN_CACHE_CONTROL;
}

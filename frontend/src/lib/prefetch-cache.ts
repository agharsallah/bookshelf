/**
 * Prefetched pages that the ClientRouter can reuse. Astro prefetches a link with
 * `<link rel="prefetch">` when you start to follow it, and the router then fetches the
 * same page again. Pages here are rendered per request and send no cache headers, so
 * the browser kept neither copy and the server rendered every page twice.
 *
 * A prefetch response alone (the browser marks the request `Sec-Purpose: prefetch`) is
 * kept for a few seconds, private to this browser: long enough for the click that
 * follows, short enough that a page you come back to later is rendered afresh. Ordinary
 * requests stay uncached.
 */

export const PREFETCH_MAX_AGE_SECONDS = 10;

/** Whether the browser sent this request as a prefetch. */
export function isPrefetch(headers: Headers): boolean {
  const purpose = headers.get('sec-purpose') ?? headers.get('purpose') ?? '';
  return purpose.split(/[;,]/)[0]?.trim().toLowerCase() === 'prefetch';
}

/**
 * The `Cache-Control` to add to a response, or null to leave it alone: a prefetched HTML
 * page that succeeded and says nothing about caching itself.
 */
export function prefetchCacheControl(request: Headers, response: Response): string | null {
  if (!isPrefetch(request) || response.status !== 200) return null;
  if (response.headers.has('cache-control')) return null;
  if (!(response.headers.get('content-type') ?? '').startsWith('text/html')) return null;
  return `private, max-age=${PREFETCH_MAX_AGE_SECONDS}`;
}

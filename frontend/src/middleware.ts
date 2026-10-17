/**
 * Runs before every on-demand page and the /api proxy: refuses hosts that are not on
 * ALLOWED_HOSTS (DNS rebinding) and proxied writes from other origins. The rules live
 * in lib/security/request-guard.ts. Prerendered pages have no request to check.
 *
 * A prefetched page is kept briefly by the browser so the click that follows reuses it
 * (lib/prefetch-cache.ts). In the read-only demo every read opts into route caching instead
 * (lib/demo-cache.ts; Vercel's CDN there), which serves the click as well. A page that
 * could not reach the backend while it rendered goes out as 503, so no cache keeps it.
 */
import type { APIContext, MiddlewareNext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import { PUBLIC_DEMO } from 'astro:env/client';
import { ALLOWED_HOSTS } from 'astro:env/server';
import { trackUpstream } from './lib/api/upstream';
import { DEMO_CACHE, demoCacheable } from './lib/demo-cache';
import { prefetchCacheControl } from './lib/prefetch-cache';
import { checkRequest, parseAllowedHosts } from './lib/security/request-guard';

const allowed = parseAllowedHosts(ALLOWED_HOSTS);

/** The demo's reads, cached unless the backend failed while one rendered. */
async function withDemoCaching(context: APIContext, next: MiddlewareNext): Promise<Response> {
  if (!context.cache.enabled || !demoCacheable(context.request)) return next();
  context.cache.set(DEMO_CACHE);
  const { result: response, failed } = await trackUpstream(() => next());
  if (!failed) return response;
  context.cache.set(false);
  return new Response(response.body, { status: 503, statusText: 'Backend unavailable', headers: response.headers });
}

async function withPrefetchCaching(request: Request, pending: Promise<Response>): Promise<Response> {
  const response = await pending;
  const cacheControl = prefetchCacheControl(request.headers, response);
  if (cacheControl) response.headers.set('Cache-Control', cacheControl);
  return response;
}

export const onRequest = defineMiddleware((context, next) => {
  if (context.isPrerendered) return next();
  const { request, url } = context;
  const refusal = checkRequest(
    {
      method: request.method,
      pathname: url.pathname,
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
    },
    allowed,
  );
  if (refusal) {
    return new Response(refusal.message, { status: refusal.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!PUBLIC_DEMO) return withPrefetchCaching(request, next());
  return withDemoCaching(context, next);
});

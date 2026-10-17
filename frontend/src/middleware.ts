/**
 * Runs before every on-demand page and the /api proxy: refuses hosts that are not on
 * ALLOWED_HOSTS (DNS rebinding) and proxied writes from other origins. The rules live
 * in lib/security/request-guard.ts. Prerendered pages have no request to check.
 *
 * A prefetched page is kept briefly by the browser so the click that follows reuses it
 * (lib/prefetch-cache.ts). In the read-only demo every read opts into route caching instead
 * (lib/demo-cache.ts; Vercel's CDN there), which serves the click as well.
 */
import { defineMiddleware } from 'astro:middleware';
import { PUBLIC_DEMO } from 'astro:env/client';
import { ALLOWED_HOSTS } from 'astro:env/server';
import { DEMO_CACHE, demoCacheable } from './lib/demo-cache';
import { prefetchCacheControl } from './lib/prefetch-cache';
import { checkRequest, parseAllowedHosts } from './lib/security/request-guard';

const allowed = parseAllowedHosts(ALLOWED_HOSTS);

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
  if (context.cache.enabled && demoCacheable(request)) context.cache.set(DEMO_CACHE);
  return next();
});

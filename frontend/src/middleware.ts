/**
 * Runs before every on-demand page and the /api proxy: refuses hosts that are not on
 * ALLOWED_HOSTS (DNS rebinding) and proxied writes from other origins. The rules live
 * in lib/security/request-guard.ts. Prerendered pages have no request to check.
 *
 * A prefetched page is kept briefly by the browser so the click that follows reuses it
 * (lib/prefetch-cache.ts). In the read-only demo every successful read is kept by Vercel's
 * CDN instead (lib/demo-cache.ts), which serves the click as well.
 */
import { defineMiddleware } from 'astro:middleware';
import { PUBLIC_DEMO } from 'astro:env/client';
import { ALLOWED_HOSTS } from 'astro:env/server';
import { demoCdnCacheControl } from './lib/demo-cache';
import { prefetchCacheControl } from './lib/prefetch-cache';
import { checkRequest, parseAllowedHosts } from './lib/security/request-guard';

const allowed = parseAllowedHosts(ALLOWED_HOSTS);

async function withCaching(request: Request, pending: Promise<Response>): Promise<Response> {
  const response = await pending;
  if (PUBLIC_DEMO) {
    // Not the prefetch header too: the CDN does not keep a `private` response.
    const cdn = demoCdnCacheControl(request.method, response);
    if (cdn) response.headers.set('CDN-Cache-Control', cdn);
    return response;
  }
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
  if (!refusal) return withCaching(request, next());
  return new Response(refusal.message, { status: refusal.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
});

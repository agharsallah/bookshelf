/**
 * Same-origin proxy to the FastAPI backend: `/api/<path>` → `<backend>/<path>`.
 * Islands call this instead of the backend so the API key stays on the server
 * and the browser needs no CORS. Request shaping lives in lib/api/proxy.ts.
 */
import type { APIRoute } from 'astro';
import { PUBLIC_DEMO } from 'astro:env/client';
import {
  buildProxyRequest,
  MUTATING_METHODS,
  proxyErrorResponse,
  proxyResponseHeaders,
  ProxyPathError,
} from '../../lib/api/proxy';
import { proxyConfig } from '../../lib/api/server';
import { upstreamFetch, WAKE_DELAYS_MS } from '../../lib/api/upstream';
import { staleTagsAfter } from '../../lib/route-cache';

export const prerender = false;

export const ALL: APIRoute = async ({ request, params, url, cache }) => {
  // The read-only demo (docs/DEMO.md). The backend refuses writes too: it has no key from us.
  if (PUBLIC_DEMO && MUTATING_METHODS.has(request.method.toUpperCase())) {
    return proxyErrorResponse(403, 'demo_read_only', 'This is a read-only demo: changes are switched off.');
  }
  const config = proxyConfig();
  let upstream;
  try {
    upstream = buildProxyRequest(
      { method: request.method, path: params.path ?? '', search: url.search, headers: request.headers },
      config,
    );
  } catch (error) {
    if (error instanceof ProxyPathError) return proxyErrorResponse(400, 'bad_path', error.message);
    throw error;
  }

  const hasBody = upstream.method !== 'GET' && upstream.method !== 'HEAD';
  let response: Response;
  try {
    // The body is streamed through, not read into memory first: a snapshot restore
    // uploads the whole library. Node's fetch needs `duplex` to send a stream.
    // A read waits for a sleeping demo API to wake (lib/api/upstream.ts); a write never repeats.
    const send = PUBLIC_DEMO && !hasBody ? upstreamFetch(globalThis.fetch, WAKE_DELAYS_MS) : fetch;
    response = await send(upstream.url, {
      method: upstream.method,
      headers: upstream.headers,
      body: hasBody ? request.body : undefined,
      duplex: 'half',
      redirect: 'manual',
      signal: request.signal,
    } as RequestInit);
  } catch {
    return proxyErrorResponse(502, 'upstream_unavailable', 'The Bookshelf API could not be reached.');
  }

  // After the backend has the write, so the next render reads it.
  const stale = staleTagsAfter(upstream.method);
  if (stale.length > 0 && cache.enabled) await cache.invalidate({ tags: stale });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: proxyResponseHeaders(response.headers, { backendUrl: config.backendUrl, upstreamUrl: upstream.url }),
  });
};

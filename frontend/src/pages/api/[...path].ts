/**
 * Same-origin proxy to the FastAPI backend: `/api/<path>` → `<backend>/<path>`.
 * Islands call this instead of the backend so the API key stays on the server
 * and the browser needs no CORS. Request shaping lives in lib/api/proxy.ts.
 */
import type { APIRoute } from 'astro';
import {
  buildProxyRequest,
  proxyErrorResponse,
  proxyResponseHeaders,
  ProxyPathError,
} from '../../lib/api/proxy';
import { proxyConfig } from '../../lib/api/server';

export const prerender = false;

export const ALL: APIRoute = async ({ request, params, url }) => {
  let upstream;
  try {
    upstream = buildProxyRequest(
      { method: request.method, path: params.path ?? '', search: url.search, headers: request.headers },
      proxyConfig(),
    );
  } catch (error) {
    if (error instanceof ProxyPathError) return proxyErrorResponse(400, 'bad_path', error.message);
    throw error;
  }

  const hasBody = upstream.method !== 'GET' && upstream.method !== 'HEAD';
  let response: Response;
  try {
    response = await fetch(upstream.url, {
      method: upstream.method,
      headers: upstream.headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual',
      signal: request.signal,
    });
  } catch {
    return proxyErrorResponse(502, 'upstream_unavailable', 'The Bookshelf API could not be reached.');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: proxyResponseHeaders(response.headers),
  });
};

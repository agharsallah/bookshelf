/**
 * Pure request/response shaping for the same-origin `/api/*` proxy
 * (src/pages/api/[...path].ts). The browser never sees the API key: it is added
 * here, server-side, and only on mutating methods; any key a client sends is dropped.
 */

export const API_KEY_HEADER = 'X-API-Key';

export const MUTATING_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Client headers worth forwarding. Everything else (cookies, auth, keys) stays behind. */
const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'content-type',
  'x-request-id',
  'last-event-id',
  'if-none-match',
  'if-modified-since',
];

/** Response headers that describe the upstream hop, not the payload we re-send. */
const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding',
  'content-length',
  'upgrade',
]);

/** Probes the backend serves at its root rather than under the API prefix. */
const ROOT_PATHS = new Set(['health', 'health/ready']);

export interface ProxyConfig {
  /** Backend base URL including the version prefix, e.g. http://localhost:8000/api/v1. */
  backendUrl: string;
  apiSecret?: string | undefined;
}

export interface IncomingProxyRequest {
  method: string;
  /** The catch-all path after `/api/`, e.g. `documents/42/tree`. */
  path: string;
  /** The raw query string including `?`, or empty. */
  search: string;
  headers: Headers;
}

export interface ProxyRequest {
  url: string;
  method: string;
  headers: Headers;
}

export class ProxyPathError extends Error {}

/** Resolve the upstream URL. Rejects `..`/empty segments so a path cannot climb out of the prefix. */
export function proxyTarget(backendUrl: string, path: string, search = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/');
  if (!clean || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new ProxyPathError(`Refusing to proxy path "${path}".`);
  }
  const base = ROOT_PATHS.has(clean)
    ? new URL(backendUrl).origin
    : backendUrl.replace(/\/+$/, '');
  return `${base}/${clean}${search}`;
}

/** Build the upstream request: allow-listed headers, plus the key on mutating methods. */
export function buildProxyRequest(incoming: IncomingProxyRequest, config: ProxyConfig): ProxyRequest {
  const method = incoming.method.toUpperCase();
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (MUTATING_METHODS.has(method) && config.apiSecret) {
    headers.set(API_KEY_HEADER, config.apiSecret);
  }
  return {
    url: proxyTarget(config.backendUrl, incoming.path, incoming.search),
    method,
    headers,
  };
}

/** Copy upstream response headers minus the hop-by-hop ones. */
export function proxyResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  upstream.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });
  return headers;
}

/** An error envelope in the backend's own shape, for failures the proxy itself detects. */
export function proxyErrorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, details: [], request_id: crypto.randomUUID().replaceAll('-', '') } },
    { status },
  );
}

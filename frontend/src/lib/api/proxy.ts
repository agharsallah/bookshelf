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
  // Seeking in audio: the player asks for byte ranges, and resumes them only if unchanged.
  'range',
  'if-range',
];

/** Response headers that describe the upstream hop, not the payload we re-send. */
const HOP_BY_HOP_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'upgrade']);

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

/**
 * Characters the WHATWG URL parser rewrites while resolving: `\\` becomes `/`, and
 * tabs/newlines are dropped. Either lets a segment turn into `..` after our check.
 */
function hasUrlRewrittenChar(path: string): boolean {
  return [...path].some((c) => {
    const code = c.charCodeAt(0);
    return c === '\\' || code < 0x20 || code === 0x7f;
  });
}

/** A `.`/`..` segment, including the percent-encoded spellings fetch also resolves. */
function isDotSegment(segment: string): boolean {
  const dots = segment.replace(/%2e/gi, '.');
  return dots === '.' || dots === '..';
}

/**
 * Resolve the upstream URL. Rejects dot/empty segments and characters the URL parser
 * rewrites, then checks the resolved URL is still under the prefix, so a path cannot
 * climb out of it.
 */
export function proxyTarget(backendUrl: string, path: string, search = ''): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  const segments = clean.split('/');
  if (!clean || hasUrlRewrittenChar(clean) || segments.some((s) => s === '' || isDotSegment(s))) {
    throw new ProxyPathError(`Refusing to proxy path "${path}".`);
  }
  const base = ROOT_PATHS.has(clean)
    ? new URL(backendUrl).origin
    : backendUrl.replace(/\/+$/, '');
  const target = `${base}/${clean}${search}`;
  const resolved = new URL(target);
  const prefix = `${new URL(base).pathname.replace(/\/+$/, '')}/`;
  if (resolved.origin !== new URL(base).origin || !resolved.pathname.startsWith(prefix)) {
    throw new ProxyPathError(`Refusing to proxy path "${path}".`);
  }
  return target;
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

/** Where the proxy is mounted in the browser's origin. */
export const PROXY_MOUNT = '/api';

export interface LocationContext {
  /** Backend base URL including the version prefix (ProxyConfig.backendUrl). */
  backendUrl: string;
  /** The upstream URL the response answers, for resolving relative locations. */
  upstreamUrl: string;
}

/**
 * A backend `Location` as the browser should see it: under the backend's API prefix →
 * the same path under `/api`; anywhere else (another host, the backend root) → null,
 * so the internal address never reaches the browser.
 */
export function proxyLocation(location: string, context: LocationContext): string | null {
  if (!URL.canParse(location, context.upstreamUrl)) return null;
  const target = new URL(location, context.upstreamUrl);
  const base = new URL(context.backendUrl);
  const prefix = `${base.pathname.replace(/\/+$/, '')}/`;
  if (target.origin !== base.origin || !target.pathname.startsWith(prefix)) return null;
  return `${PROXY_MOUNT}/${target.pathname.slice(prefix.length)}${target.search}${target.hash}`;
}

/**
 * Copy upstream response headers minus the hop-by-hop ones. With `context`, a
 * `Location` is rewritten to the proxy path or dropped (see `proxyLocation`).
 */
export function proxyResponseHeaders(upstream: Headers, context?: LocationContext): Headers {
  const headers = new Headers();
  upstream.forEach((value, key) => {
    const name = key.toLowerCase();
    if (HOP_BY_HOP_RESPONSE_HEADERS.has(name)) return;
    // fetch decodes a compressed body, so its length no longer holds; an uncompressed one
    // (audio, which players need the size of to seek) keeps it.
    if (name === 'content-length' && upstream.has('content-encoding')) return;
    if (name === 'location') {
      const mapped = context ? proxyLocation(value, context) : null;
      if (mapped) headers.set(key, mapped);
      return;
    }
    headers.set(key, value);
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

/**
 * Typed fetch client for the Bookshelf API. It is transport-agnostic: give it a base
 * URL (the backend directly on the server, `/api` in the browser) and it builds URLs,
 * encodes JSON and turns failures into `ApiError`.
 *
 * Use `browserApi` from islands and `serverApi()` (./server) from page frontmatter.
 */
import { ApiError, toApiError } from './errors';

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue | QueryValue[]>;

export interface RequestOptions {
  query?: Query;
  /** JSON-encoded, except a `Blob` (a `File`), which is sent as it is: an upload. */
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
  /** Let the request outlive the page (a last save on `pagehide`). */
  keepalive?: boolean;
}

export interface ApiClient {
  get<T>(path: string, options?: Omit<RequestOptions, 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
  /** The absolute or root-relative URL a path resolves to (for links, EventSource…). */
  url(path: string, query?: Query): string;
}

export interface ClientConfig {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Headers added to every request (the server client adds X-API-Key here). */
  headers?: HeadersInit;
}

/** Join a base and a path with exactly one slash, then append the query string. */
export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const base = baseUrl.replace(/\/+$/, '');
  const rel = path.replace(/^\/+/, '');
  const params = new URLSearchParams();
  for (const [key, raw] of Object.entries(query ?? {})) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (value !== undefined && value !== null) params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return `${base}/${rel}${qs ? `?${qs}` : ''}`;
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createApiClient(config: ClientConfig): ApiClient {
  const doFetch = config.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(config.headers);
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    headers.set('Accept', 'application/json');
    let body: BodyInit | undefined;
    if (options.body instanceof Blob) {
      headers.set('Content-Type', options.body.type || 'application/octet-stream');
      body = options.body;
    } else if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await doFetch(buildUrl(config.baseUrl, path, options.query), {
        method,
        headers,
        body,
        signal: options.signal,
        keepalive: options.keepalive,
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw toApiError(0, undefined);
    }

    const parsed = await readBody(response);
    if (!response.ok) throw toApiError(response.status, parsed, response.headers.get('x-request-id'));
    return parsed as T;
  }

  return {
    get: (path, options) => request('GET', path, options),
    post: (path, body, options) => request('POST', path, { ...options, body }),
    put: (path, body, options) => request('PUT', path, { ...options, body }),
    patch: (path, body, options) => request('PATCH', path, { ...options, body }),
    delete: (path, options) => request('DELETE', path, options),
    url: (path, query) => buildUrl(config.baseUrl, path, query),
  };
}

/** Browser client: same-origin proxy, which adds the API key server-side. */
export const browserApi: ApiClient = createApiClient({ baseUrl: '/api' });

export { ApiError };

/**
 * An in-memory `ApiClient` for DOM tests: routes by method + path to handlers and
 * records every call, so tests assert on what the island sent (commands), not how.
 */
import type { ApiClient } from '../../../lib/api/client';

export interface Call {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: unknown;
}

type Handler = (call: Call) => unknown;

export function fakeApi(routes: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const handle = async (call: Call) => {
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`] ?? Object.entries(routes).find(([k]) => k.endsWith('*') && `${call.method} ${call.path}`.startsWith(k.slice(0, -1)))?.[1];
    if (!handler) throw new Error(`No fake route for ${call.method} ${call.path}`);
    return handler(call);
  };
  const api: ApiClient = {
    get: <T>(path: string, options?: { query?: unknown }) => handle({ method: 'GET', path, query: options?.query }) as Promise<T>,
    post: <T>(path: string, body?: unknown, options?: { query?: unknown }) => handle({ method: 'POST', path, body, ...(options?.query ? { query: options.query } : {}) }) as Promise<T>,
    put: <T>(path: string, body?: unknown) => handle({ method: 'PUT', path, body }) as Promise<T>,
    patch: <T>(path: string, body?: unknown) => handle({ method: 'PATCH', path, body }) as Promise<T>,
    delete: <T>(path: string, options?: { query?: unknown }) => handle({ method: 'DELETE', path, query: options?.query }) as Promise<T>,
    url: (path: string) => `/api/${path}`,
  };
  return { api, calls };
}

export const emptyPage = { items: [], total: 0, limit: 100, offset: 0 };

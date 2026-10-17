/**
 * Server-only API access (page frontmatter, endpoints). Reads secrets from
 * `astro:env/server`, so importing this from an island is a build error by design.
 */
import { PUBLIC_API_URL } from 'astro:env/client';
import { API_INTERNAL_URL, API_SECRET } from 'astro:env/server';
import { createApiClient, type ApiClient } from './client';
import { API_KEY_HEADER, type ProxyConfig } from './proxy';
import { upstreamFetch } from './upstream';

export const DEFAULT_API_URL = 'http://localhost:8000/api/v1';

/** Where the server reaches the backend: internal URL, else the public one, else local dev. */
export function backendBaseUrl(): string {
  return API_INTERNAL_URL || PUBLIC_API_URL || DEFAULT_API_URL;
}

export function proxyConfig(): ProxyConfig {
  return { backendUrl: backendBaseUrl(), apiSecret: API_SECRET };
}

/**
 * A client that talks to the backend directly and authenticates every call. A GET the
 * backend was not ready for is tried once more (lib/api/upstream.ts).
 */
export function serverApi(fetchImpl?: typeof fetch): ApiClient {
  return createApiClient({
    baseUrl: backendBaseUrl(),
    fetch: fetchImpl ?? upstreamFetch(),
    headers: API_SECRET ? { [API_KEY_HEADER]: API_SECRET } : undefined,
  });
}

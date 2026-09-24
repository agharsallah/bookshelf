/**
 * Request checks for everything rendered on demand (src/middleware.ts), pure so they
 * can be tested without a server.
 *
 * - **Host allowlist** (DNS rebinding): a hostile page can point its own domain at
 *   127.0.0.1, and the browser then treats this app as same-origin with that page. The
 *   `Host` header still names the hostile domain, so any request whose host is not on
 *   `ALLOWED_HOSTS` is refused. Astro's `security.allowedDomains` only vets
 *   `X-Forwarded-Host`, and `checkOrigin` compares Origin with that same Host, so
 *   neither covers this.
 * - **Origin on proxied writes**: the `/api` proxy adds the API key to mutating
 *   requests, so those must come from this app's own pages. Astro's `checkOrigin` only
 *   covers form content types; JSON writes are checked here, and a write without an
 *   Origin (browsers always send one) is refused too.
 */

export const DEFAULT_ALLOWED_HOSTS = 'localhost,127.0.0.1,[::1]';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const PROXY_PREFIX = '/api/';

export interface GuardedRequest {
  method: string;
  pathname: string;
  /** The `Host` header. */
  host: string | null;
  /** The `Origin` header. */
  origin: string | null;
}

export interface Refusal {
  status: 403 | 421;
  message: string;
}

/** `ALLOWED_HOSTS` → entries. An entry without a port allows that host on any port. */
export function parseAllowedHosts(value: string | undefined): string[] {
  return (value?.trim() ? value : DEFAULT_ALLOWED_HOSTS)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const HAS_PORT = /:\d+$/;

/** Host → hostname and port; null unless it is exactly a host (no userinfo, path…). */
function hostParts(host: string): { hostname: string; port: string } | null {
  const lower = host.toLowerCase();
  try {
    const url = new URL(`http://${lower}`);
    const port = HAS_PORT.exec(lower)?.[0].slice(1) ?? '';
    return url.host === lower || url.host === lower.replace(/:80$/, '') ? { hostname: url.hostname, port } : null;
  } catch {
    return null;
  }
}

export function isAllowedHost(host: string | null, allowed: readonly string[]): boolean {
  const parts = host ? hostParts(host) : null;
  if (!parts) return false;
  return allowed.some((entry) => {
    const want = hostParts(entry);
    if (!want) return false;
    return want.hostname === parts.hostname && (!want.port || want.port === parts.port);
  });
}

/** Null when the request may proceed, else why not. */
export function checkRequest(request: GuardedRequest, allowed: readonly string[]): Refusal | null {
  if (!isAllowedHost(request.host, allowed)) {
    return { status: 421, message: 'This host is not served here. Add it to ALLOWED_HOSTS if it should be.' };
  }
  if (MUTATING.has(request.method.toUpperCase()) && request.pathname.startsWith(PROXY_PREFIX)) {
    const originHost = request.origin && URL.canParse(request.origin) ? new URL(request.origin).host : null;
    if (!originHost || originHost !== request.host?.toLowerCase()) {
      return { status: 403, message: 'Writes through /api must come from this app’s own pages.' };
    }
  }
  return null;
}

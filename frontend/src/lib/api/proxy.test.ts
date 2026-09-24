import { describe, expect, it } from 'vitest';
import { buildProxyRequest, ProxyPathError, proxyResponseHeaders, proxyTarget } from './proxy';

const config = { backendUrl: 'http://backend:8000/api/v1', apiSecret: 's3cret' };

function incoming(method: string, path: string, headers: Record<string, string> = {}, search = '') {
  return { method, path, search, headers: new Headers(headers) };
}

describe('buildProxyRequest', () => {
  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])('adds the API key on %s', (method) => {
    const req = buildProxyRequest(incoming(method, 'notes'), config);
    expect(req.headers.get('x-api-key')).toBe('s3cret');
  });

  it('does not send the key on reads', () => {
    const req = buildProxyRequest(incoming('get', 'documents', {}, '?status=ready'), config);
    expect([req.method, req.url, req.headers.get('x-api-key')]).toEqual([
      'GET',
      'http://backend:8000/api/v1/documents?status=ready',
      null,
    ]);
  });

  it('drops keys, cookies and auth sent by the browser but keeps content headers', () => {
    const req = buildProxyRequest(
      incoming('GET', 'documents', {
        'x-api-key': 'forged',
        cookie: 'a=b',
        authorization: 'Bearer x',
        'content-type': 'application/json',
        'x-request-id': 'r1',
      }),
      config,
    );
    expect(Object.fromEntries(req.headers)).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r1' });
  });

  it('omits the key when no secret is configured', () => {
    const req = buildProxyRequest(incoming('POST', 'notes'), { backendUrl: config.backendUrl });
    expect(req.headers.has('x-api-key')).toBe(false);
  });
});

describe('proxyTarget', () => {
  it('serves health probes from the backend root, not the API prefix', () => {
    expect(proxyTarget(config.backendUrl, 'health')).toBe('http://backend:8000/health');
    expect(proxyTarget(config.backendUrl, 'health/ready')).toBe('http://backend:8000/health/ready');
  });

  it.each(['../docs', 'a/../../x', '', 'a//b'])('refuses the path %j', (path) => {
    expect(() => proxyTarget(config.backendUrl, path)).toThrow(ProxyPathError);
  });

  // Astro hands the route a fully decoded path; fetch's URL parser then turns `\\`
  // into `/`, drops tabs/newlines and resolves `%2e%2e`, so these would climb out of
  // /api/v1 (with the API key attached on mutating methods).
  it.each(['..\\..\\docs', 'a\\..\\..\\..\\openapi.json', '.\t./.\t./docs', '.\n./.\n./docs', '%2e%2e/%2e%2e/docs', '.%2E/.%2e/docs'])(
    'refuses the smuggled traversal %j',
    (path) => {
      expect(() => proxyTarget(config.backendUrl, path)).toThrow(ProxyPathError);
    },
  );

  it('keeps ordinary nested paths and their query under the API prefix', () => {
    expect(proxyTarget(config.backendUrl, 'documents/42/tree', '?depth=2')).toBe(
      'http://backend:8000/api/v1/documents/42/tree?depth=2',
    );
  });
});

describe('proxyResponseHeaders: Location', () => {
  const upstream = 'http://backend:8000/api/v1/documents/42';
  const location = (value: string) =>
    proxyResponseHeaders(new Headers({ location: value }), { backendUrl: config.backendUrl, upstreamUrl: upstream }).get('location');

  it.each([
    ['an absolute backend URL', 'http://backend:8000/api/v1/documents/flow?x=1', '/api/documents/flow?x=1'],
    ['a root-relative backend path', '/api/v1/documents/flow', '/api/documents/flow'],
    ['a path relative to the request', 'tree', '/api/documents/tree'],
  ])('maps %s to the same-origin proxy path', (_label, value, expected) => {
    expect(location(value)).toBe(expected);
  });

  it.each([
    ['another host', 'https://elsewhere.example/api/v1/x'],
    ['the backend outside the API prefix', 'http://backend:8000/docs'],
    ['a sibling prefix', 'http://backend:8000/api/v10/x'],
  ])('drops a Location to %s rather than exposing it', (_label, value) => {
    expect(location(value)).toBeNull();
  });
});

describe('proxyResponseHeaders', () => {
  it('strips hop-by-hop and encoding headers the proxy re-computes', () => {
    const headers = proxyResponseHeaders(
      new Headers({ 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '10', 'x-request-id': 'r' }),
    );
    expect(Object.fromEntries(headers)).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r' });
  });
});

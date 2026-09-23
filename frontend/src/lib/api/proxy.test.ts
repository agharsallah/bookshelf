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
});

describe('proxyResponseHeaders', () => {
  it('strips hop-by-hop and encoding headers the proxy re-computes', () => {
    const headers = proxyResponseHeaders(
      new Headers({ 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': '10', 'x-request-id': 'r' }),
    );
    expect(Object.fromEntries(headers)).toEqual({ 'content-type': 'application/json', 'x-request-id': 'r' });
  });
});

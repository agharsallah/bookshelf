import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildUrl, createApiClient } from './client';
import { ApiError } from './errors';

describe('buildUrl', () => {
  it('joins base and path with one slash and encodes repeated query values', () => {
    expect(buildUrl('/api/', '/artifacts', { type: 'brief', tone: ['insight', 'antipattern'], q: undefined })).toBe(
      '/api/artifacts?type=brief&tone=insight&tone=antipattern',
    );
  });
});

describe('createApiClient against a real HTTP server', () => {
  let server: Server;
  let baseUrl: string;
  const received: { method?: string; url?: string; body: string; headers: IncomingMessage['headers'] }[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, body, headers: req.headers });
        if (req.url?.startsWith('/api/v1/missing')) {
          res.writeHead(404, { 'content-type': 'application/json', 'x-request-id': 'req-9' });
          res.end(JSON.stringify({ error: { code: 'not_found', message: 'No such document.', details: [], request_id: 'req-9' } }));
          return;
        }
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, echo: body ? JSON.parse(body) : null }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('sends JSON bodies and returns the parsed response', async () => {
    const api = createApiClient({ baseUrl, headers: { 'X-API-Key': 'k' } });
    const result = await api.post<{ ok: boolean; echo: unknown }>('notes', { raw: 'hi' });
    const last = received.at(-1);
    expect(result).toEqual({ ok: true, echo: { raw: 'hi' } });
    expect([last?.method, last?.url, last?.headers['content-type'], last?.headers['x-api-key']]).toEqual([
      'POST',
      '/api/v1/notes',
      'application/json',
      'k',
    ]);
  });

  it('sends a file as it is, with its own type, for an upload', async () => {
    const api = createApiClient({ baseUrl });
    const file = new File(['{"not": "json-encoded"}'], 'shelf.tar.gz', { type: 'application/gzip' });
    await api.post('database/snapshot/restore', file, { query: { backup: false } });
    const last = received.at(-1);
    expect([last?.url, last?.headers['content-type'], last?.body]).toEqual([
      '/api/v1/database/snapshot/restore?backup=false',
      'application/gzip',
      '{"not": "json-encoded"}',
    ]);
  });

  it('throws an ApiError carrying the backend envelope', async () => {
    const api = createApiClient({ baseUrl });
    const error = await api.get('missing/42').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found', message: 'No such document.', requestId: 'req-9' });
  });

  it('turns a refused connection into a network_error', async () => {
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:9/api' });
    await expect(api.get('health')).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });
});

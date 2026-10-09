import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { createPillsClient } from './client';
import { defaultConfig } from './config';
import { makePill, makeStart } from './testing/fixtures';
import type { PillEvent } from './types';

/** A fetch that records each request and answers with `reply(url, init)`. */
function fakeFetch(reply: (url: string, init: RequestInit) => unknown = () => ({}), status = 200) {
  const calls: { url: string; method: string; body: unknown; keepalive: boolean | undefined; headers: Headers }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      keepalive: init.keepalive,
      headers: new Headers(init.headers),
    });
    const body = reply(url, init);
    return new Response(body === undefined ? null : JSON.stringify(body), { status: body === undefined ? 204 : status, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe('createPillsClient', () => {
  it('starts a session from a config or a saved feed', async () => {
    const start = makeStart([makePill('insight')], 'c1');
    const { fetch, calls } = fakeFetch(() => start);
    const client = createPillsClient({ baseUrl: '/api', fetch, headers: { 'X-API-Key': 'k' } });
    expect(await client.startSession({ config: defaultConfig() })).toEqual(start);
    await client.startSession({ feed_id: 'f1' });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/pills/sessions', { config: defaultConfig() }],
      ['POST', '/api/pills/sessions', { feed_id: 'f1' }],
    ]);
    expect(calls[0]!.headers.get('X-API-Key')).toBe('k');
  });

  it('pages with an opaque cursor and finishes on the summary', async () => {
    const summary = { seen: 3, saved: 1, answered: 2, correct: 1, due_tomorrow: 4, minutes: 2 };
    const { fetch, calls } = fakeFetch((url) => (url.endsWith('/finish') ? { summary } : { pills: [], next_cursor: null, supply: {}, done: true }));
    const client = createPillsClient({ baseUrl: 'http://api.test/', fetch });
    await client.page('s 1', { cursor: '10' });
    await client.page('s1');
    expect(await client.finish('s1')).toEqual(summary);
    expect(calls.map((c) => c.url)).toEqual([
      'http://api.test/pills/sessions/s%201?cursor=10&limit=10',
      'http://api.test/pills/sessions/s1?limit=10',
      'http://api.test/pills/sessions/s1/finish',
    ]);
  });

  it('sends events, keeping a last flush alive, and refuses an oversized batch', async () => {
    const { fetch, calls } = fakeFetch(() => ({ accepted: 1, duplicates: 0, ignored: 0 }));
    const client = createPillsClient({ baseUrl: '/api', fetch });
    const event: PillEvent = { id: 'e1', kind: 'seen', pill_id: 'p1', at: '2026-10-06T08:00:00Z' };
    expect(await client.sendEvents([event], { keepalive: true })).toEqual({ accepted: 1, duplicates: 0, ignored: 0 });
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/pills/events', body: { events: [event] }, keepalive: true });
    expect(() => client.sendEvents(Array.from({ length: 201 }, () => event))).toThrow(RangeError);
  });

  it('asks for supply with the config as JSON, and queues generation and rebuilds', async () => {
    const { fetch, calls } = fakeFetch(() => ({ jobs: ['j1'], estimate_tokens: 9000 }));
    const client = createPillsClient({ baseUrl: '/api', fetch });
    await client.supply(defaultConfig());
    await client.generate({ document: 'd1', anchors: ['ch02'] });
    await client.rebuild();
    await client.rebuild('d1');
    await client.pill('p1');
    expect(new URL(calls[0]!.url, 'http://x').searchParams.get('config')).toBe(JSON.stringify(defaultConfig()));
    expect(calls.slice(1).map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', '/api/pills/generate', { document: 'd1', anchors: ['ch02'] }],
      ['POST', '/api/pills/rebuild', {}],
      ['POST', '/api/pills/rebuild', { document: 'd1' }],
      ['GET', '/api/pills/p1', undefined],
    ]);
  });

  it('lists, creates, renames and deletes saved feeds', async () => {
    const feed = { id: 'f1', name: 'Mornings', config: defaultConfig(), created_at: '', updated_at: '' };
    const { fetch, calls } = fakeFetch((url, init) => (init.method === 'DELETE' ? undefined : url.endsWith('/pills/feeds') && init.method === 'GET' ? { items: [feed] } : feed));
    const client = createPillsClient({ baseUrl: '/api', fetch });
    expect(await client.feeds()).toEqual([feed]);
    await client.createFeed({ name: 'Mornings', config: defaultConfig() });
    await client.updateFeed('f1', { name: 'Evenings' });
    await client.deleteFeed('f1');
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', '/api/pills/feeds'],
      ['POST', '/api/pills/feeds'],
      ['PATCH', '/api/pills/feeds/f1'],
      ['DELETE', '/api/pills/feeds/f1'],
    ]);
  });

  it('turns the error envelope into an ApiError', async () => {
    const { fetch } = fakeFetch(() => ({ error: { code: 'not_found', message: 'No such session.', details: [], request_id: 'r1' } }), 404);
    const client = createPillsClient({ baseUrl: '/api', fetch });
    const error = await client.page('nope').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, code: 'not_found' });
  });
});

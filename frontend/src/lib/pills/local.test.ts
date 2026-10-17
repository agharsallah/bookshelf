import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../api/client';
import { defaultConfig } from './config';
import { createLocalPillsClient, LOCAL_EVENTS_KEY, localReviewApi, summarize } from './local';
import { memoryStorage } from './storage';
import { makePill } from './testing/fixtures';
import type { Pill, PillEvent, SessionContinuation } from './types';

const SUPPLY = { unseen: 14, by_document: [], low: false };

/** The server's compose: the next `limit` of a fixed shelf after `served`. Writes refused. */
function fakeApi(shelf: Pill[]) {
  const composed: Record<string, unknown>[] = [];
  const refuse = async () => {
    throw new Error('the demo writes nothing');
  };
  const api = {
    get: async <T,>(path: string, options: { query?: Record<string, unknown> } = {}): Promise<T> => {
      if (path === 'pills/feeds') return { items: [] } as T;
      if (path !== 'pills/compose') throw new Error(`unexpected GET ${path}`);
      const query = options.query ?? {};
      composed.push(query);
      const served = String(query.served ?? '').split(',').filter(Boolean);
      const next = shelf.filter((p) => !served.includes(p.id)).slice(0, Number(query.limit));
      const reached = served.length + next.length;
      const page: SessionContinuation = { pills: next, next_cursor: reached < shelf.length ? String(reached) : null, supply: SUPPLY, done: reached >= shelf.length, notice: null };
      return page as T;
    },
    post: refuse,
    patch: refuse,
    delete: refuse,
  } as unknown as Pick<ApiClient, 'get' | 'post' | 'patch' | 'delete'>;
  return { api, composed };
}

const seen = (id: string, sessionId: string, pillId: string): PillEvent => ({ id, session_id: sessionId, pill_id: pillId, kind: 'seen', at: '2026-10-17T10:00:00Z' });

function setup(count = 14) {
  const shelf = Array.from({ length: count }, () => makePill('insight'));
  const { api, composed } = fakeApi(shelf);
  const storage = memoryStorage();
  let n = 0;
  const client = createLocalPillsClient({ api, storage, newId: () => `local-${++n}`, newSeed: () => 7, now: () => new Date('2026-10-17T10:00:00Z') });
  return { shelf, client, storage, composed };
}

describe('createLocalPillsClient', () => {
  it('serves a session from compose and keeps it in the browser', async () => {
    const { shelf, client, composed } = setup();
    const start = await client.startSession({ config: { ...defaultConfig(), length: 20 } });

    expect(start.session).toMatchObject({ id: 'local-1', seed: 7, position: 0 });
    expect(start.page.pills.map((p) => p.id)).toEqual(shelf.slice(0, 10).map((p) => p.id));
    expect(start.page.next_cursor).toBe('10');
    expect(composed[0]).toMatchObject({ seed: 7, served: '', limit: 10 });

    const again = await client.page('local-1', { cursor: '0', limit: 5 });
    expect(again.pills.map((p) => p.id)).toEqual(shelf.slice(0, 5).map((p) => p.id));
    expect(composed).toHaveLength(1); // already served: no second call

    const rest = await client.page('local-1', { cursor: '10' });
    expect([rest.pills.length, rest.next_cursor, rest.done]).toEqual([4, null, true]);
    expect(composed[1]?.served).toBe(shelf.slice(0, 10).map((p) => p.id).join(','));
  });

  it('stops at the session length', async () => {
    const { client } = setup(30);
    await client.startSession({ config: { ...defaultConfig(), length: 10 } });
    const page = await client.page('local-1', { cursor: '0' });
    expect([page.pills.length, page.next_cursor, page.done]).toEqual([10, null, true]);
  });

  it('records events locally, moves the place on and sums the session up', async () => {
    const { shelf, client, storage } = setup();
    await client.startSession({ config: defaultConfig() });
    const batch: PillEvent[] = [
      seen('e1', 'local-1', shelf[0]!.id),
      seen('e2', 'local-1', shelf[2]!.id),
      { id: 'e3', session_id: 'local-1', pill_id: shelf[2]!.id, kind: 'answer', value: { correct: true }, at: '2026-10-17T10:01:00Z' },
      { id: 'e4', session_id: 'local-1', pill_id: shelf[2]!.id, kind: 'save', at: '2026-10-17T10:01:00Z' },
    ];

    expect(await client.sendEvents(batch)).toEqual({ accepted: 4, duplicates: 0, ignored: 0 });
    expect(await client.sendEvents(batch.slice(0, 1))).toEqual({ accepted: 0, duplicates: 1, ignored: 0 });
    expect(JSON.parse((await storage.get(LOCAL_EVENTS_KEY)) ?? '[]')).toHaveLength(4);

    const resumed = await client.page('local-1');
    expect(resumed.pills[0]?.id).toBe(shelf[3]!.id); // after the last one seen

    expect(await client.finish('local-1')).toMatchObject({ seen: 2, saved: 1, answered: 1, correct: 1 });
  });

  it('saves feeds in the browser', async () => {
    const { client } = setup();
    const feed = await client.createFeed({ name: 'Mornings', config: defaultConfig() });
    expect((await client.feeds()).map((f) => f.name)).toEqual(['Mornings']);
    await client.updateFeed(feed.id, { name: 'Evenings' });
    expect((await client.feeds())[0]?.name).toBe('Evenings');
    await client.deleteFeed(feed.id);
    expect(await client.feeds()).toEqual([]);
  });
});

describe('summarize', () => {
  it('counts an unsave and long dwells', () => {
    const at = '2026-10-17T10:00:00Z';
    expect(
      summarize([
        { id: '1', pill_id: 'a', kind: 'save', at },
        { id: '2', pill_id: 'a', kind: 'unsave', at },
        { id: '3', pill_id: 'a', kind: 'dwell', value: { ms: 90_000 }, at },
      ]),
    ).toMatchObject({ saved: 0, minutes: 2 });
  });
});

describe('localReviewApi', () => {
  it('answers a rating here and passes anything else on', async () => {
    const posted: string[] = [];
    const api = { post: async (path: string) => (posted.push(path), { ok: true }) } as unknown as Pick<ApiClient, 'post'>;
    const reviews = localReviewApi(api, () => new Date('2026-10-17T10:00:00Z'));

    expect(await reviews.post('reviews/r1/rating', { rating: 3, answer: '' })).toEqual({ id: 'r1', due: '2026-10-17T10:00:00.000Z', last_rating: 3 });
    await reviews.post('recalls', {});
    expect(posted).toEqual(['recalls']);
  });
});

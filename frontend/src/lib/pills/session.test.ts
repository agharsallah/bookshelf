import { describe, expect, it, vi } from 'vitest';
import type { PillsClient } from './client';
import { createSessionController, currentPill, flatIndex, groupPills, initialSessionState, pillsAhead, sessionReducer, type SessionState } from './session';
import { makePage, makePill, makeStart, makeThread } from './testing/fixtures';
import type { Pill, SessionSummary } from './types';

const SUMMARY: SessionSummary = { seen: 3, saved: 1, answered: 1, correct: 1, due_tomorrow: 2, minutes: 2 };

const singles = (n: number): Pill[] => Array.from({ length: n }, () => makePill('insight') as Pill);

function started(pills: Pill[], cursor: string | null = null): SessionState {
  return sessionReducer(initialSessionState, { type: 'started', start: makeStart(pills, cursor) });
}

function fakeClient(overrides: Partial<PillsClient> = {}) {
  return {
    startSession: vi.fn(async () => makeStart(singles(3), null)),
    page: vi.fn(async () => makePage([], null)),
    finish: vi.fn(async () => SUMMARY),
    ...overrides,
  };
}

describe('groupPills', () => {
  it('keeps a thread together, in thread order, between lone pills', () => {
    const [a, b] = singles(2);
    const thread = makeThread('t1', 3);
    const groups = groupPills([a!, thread[2]!, thread[0]!, thread[1]!, b!]);
    expect(groups.map((g) => g.pills.length)).toEqual([1, 3, 1]);
    expect(groups[1]!.key).toBe('t1');
    expect(groups[1]!.pills.map((p) => p.thread?.index)).toEqual([0, 1, 2]);
  });
});

describe('sessionReducer', () => {
  it('moves down and up between groups, and sideways within a thread', () => {
    let state = started([...singles(1), ...makeThread('t', 3), ...singles(1)], null);
    expect(state.status).toBe('active');
    state = sessionReducer(state, { type: 'next' });
    expect(currentPill(state)?.thread?.index).toBe(0);
    state = sessionReducer(state, { type: 'stepRight' });
    state = sessionReducer(state, { type: 'stepRight' });
    state = sessionReducer(state, { type: 'stepRight' });
    expect(state.step).toBe(2);
    expect(flatIndex(state)).toBe(3);
    state = sessionReducer(state, { type: 'stepLeft' });
    expect(state.step).toBe(1);
    state = sessionReducer(state, { type: 'next' });
    expect([state.position, state.step]).toEqual([2, 0]);
    state = sessionReducer(state, { type: 'previous' });
    expect([state.position, state.step]).toEqual([1, 0]);
  });

  it('does not go above the first pill', () => {
    const state = started(singles(2));
    expect(sessionReducer(state, { type: 'previous' })).toBe(state);
  });

  it('reaches the end card past the last pill only once nothing more will come', () => {
    const open = started(singles(1), 'c1');
    expect(sessionReducer(open, { type: 'next' }).status).toBe('active');
    const done = started(singles(1), null);
    expect(sessionReducer(done, { type: 'next' }).status).toBe('ending');
  });

  it('appends pages without repeating a pill, and learns when the session is done', () => {
    const pills = singles(2);
    let state = started(pills, 'c1');
    const more = singles(2);
    state = sessionReducer(state, { type: 'page', page: makePage([pills[1]!, ...more], 'c2', false) });
    expect(state.pills.map((p) => p.id)).toEqual([...pills, ...more].map((p) => p.id));
    expect(state.cursor).toBe('c2');
    state = sessionReducer(state, { type: 'page', page: makePage([], 'c3', true) });
    expect(state.done).toBe(true);
  });

  it('counts the pills ahead of the current group', () => {
    const state = started([...makeThread('t', 3), ...singles(2)]);
    expect(pillsAhead(state)).toBe(2);
  });

  it('fails into error only when the session never started', () => {
    const loading = sessionReducer(initialSessionState, { type: 'loading' });
    expect(sessionReducer(loading, { type: 'failed', error: 'x' }).status).toBe('error');
    expect(sessionReducer(started(singles(1)), { type: 'failed', error: 'x' })).toMatchObject({ status: 'active', error: 'x' });
  });
});

describe('createSessionController', () => {
  it('starts, tells subscribers, and finishes on the summary past the end', async () => {
    const client = fakeClient();
    const session = createSessionController({ client });
    const seen = vi.fn();
    session.subscribe(seen);
    await session.start({ config: makeStart([]).session.config });
    expect(session.getState().status).toBe('active');
    session.next();
    session.next();
    session.next();
    await vi.waitFor(() => expect(session.getState().status).toBe('ended'));
    expect(session.getState().summary).toEqual(SUMMARY);
    expect(client.finish).toHaveBeenCalledWith(makeStart([]).session.id);
    expect(seen).toHaveBeenCalled();
  });

  it('prefetches the next page as soon as fewer than five pills are ahead', async () => {
    const more = singles(10);
    const client = fakeClient({
      startSession: vi.fn(async () => makeStart(singles(3), 'c1')),
      page: vi.fn(async () => makePage(more, null)),
    });
    const session = createSessionController({ client });
    await session.start({ feed_id: 'f1' });
    await vi.waitFor(() => expect(session.getState().pills).toHaveLength(13));
    expect(client.page).toHaveBeenCalledTimes(1);
    expect(client.page).toHaveBeenCalledWith(makeStart([]).session.id, { cursor: 'c1', limit: 10 });
  });

  it('resumes a session from its saved position', async () => {
    const client = fakeClient({ page: vi.fn(async () => makePage(singles(2), null, true)) });
    const session = createSessionController({ client });
    await session.resume('s9');
    expect(client.page).toHaveBeenCalledWith('s9', { limit: 10 });
    expect(session.getState()).toMatchObject({ status: 'active', sessionId: 's9', done: true });
  });

  it('ends early, after sending what is waiting, and a failed start says why', async () => {
    const order: string[] = [];
    const client = fakeClient({ finish: vi.fn(async () => (order.push('finish'), SUMMARY)) });
    const session = createSessionController({ client, beforeFinish: async () => order.push('flush') });
    await session.start({ feed_id: 'f1' });
    session.end();
    await vi.waitFor(() => expect(session.getState().status).toBe('ended'));
    expect(order).toEqual(['flush', 'finish']);

    const broken = createSessionController({ client: fakeClient({ startSession: vi.fn(async () => Promise.reject(new Error('API down'))) }) });
    await broken.start({ feed_id: 'f1' });
    expect(broken.getState()).toMatchObject({ status: 'error', error: 'API down' });
  });
});

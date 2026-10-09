import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import { backoffMs, createEventQueue, EVENTS_STORAGE_KEY, isRetryableError, newEventId, type Lifecycle, type Timers } from './events';
import { memoryStorage } from './storage';
import type { PillEvent } from './types';

/** Timers you run by hand: `due()` lists what is waiting, `run()` fires the earliest. */
function manualTimers(): Timers & { due(): number[]; run(): void } {
  let next = 1;
  const waiting = new Map<number, { run: () => void; ms: number }>();
  return {
    setTimeout: (run, ms) => {
      const id = next++;
      waiting.set(id, { run, ms });
      return id;
    },
    clearTimeout: (id) => void waiting.delete(id as number),
    due: () => [...waiting.values()].map((t) => t.ms),
    run: () => {
      const [id, timer] = [...waiting.entries()].sort((a, b) => a[1].ms - b[1].ms)[0] ?? [];
      if (id === undefined || !timer) return;
      waiting.delete(id);
      timer.run();
    },
  };
}

function manualLifecycle(): Lifecycle & { hide(): void } {
  const listeners = new Set<() => void>();
  return {
    onHide: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hide: () => listeners.forEach((l) => l()),
  };
}

const flushed = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<Parameters<typeof createEventQueue>[0]> = {}) {
  let n = 0;
  const sent: { events: PillEvent[]; keepalive: boolean }[] = [];
  const send = vi.fn(async (events: readonly PillEvent[], { keepalive }: { keepalive: boolean }) => {
    sent.push({ events: [...events], keepalive });
  });
  const timers = manualTimers();
  const storage = memoryStorage();
  const lifecycle = manualLifecycle();
  const queue = createEventQueue({
    send,
    storage,
    timers,
    lifecycle,
    flushAt: 3,
    intervalMs: 1000,
    newId: () => `e${++n}`,
    now: () => new Date('2026-10-06T08:00:00Z'),
    ...overrides,
  });
  return { queue, send, sent, timers, storage, lifecycle };
}

describe('createEventQueue', () => {
  it('stamps each event with a client id and time, and persists it before sending', async () => {
    const { queue, storage, send } = setup();
    await queue.ready;
    const event = queue.push({ kind: 'seen', pill_id: 'p1', session_id: 's1' });
    expect(event).toEqual({ kind: 'seen', pill_id: 'p1', session_id: 's1', id: 'e1', at: '2026-10-06T08:00:00.000Z' });
    await flushed();
    expect(JSON.parse(storage.snapshot()[EVENTS_STORAGE_KEY]!)).toEqual([event]);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a batch once enough events wait, then forgets them', async () => {
    const { queue, sent, storage } = setup();
    await queue.ready;
    ['seen', 'dwell', 'save'].forEach((kind) => queue.push({ kind: kind as PillEvent['kind'], pill_id: 'p1' }));
    await flushed();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.events.map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(queue.pending()).toEqual([]);
    expect(JSON.parse(storage.snapshot()[EVENTS_STORAGE_KEY]!)).toEqual([]);
  });

  it('sends a short batch after the interval', async () => {
    const { queue, sent, timers } = setup();
    await queue.ready;
    queue.push({ kind: 'seen', pill_id: 'p1' });
    expect(timers.due()).toEqual([1000]);
    timers.run();
    await flushed();
    expect(sent.map((b) => b.events.length)).toEqual([1]);
  });

  it('flushes with keepalive when the app is hidden', async () => {
    const { queue, sent, lifecycle } = setup();
    await queue.ready;
    queue.push({ kind: 'dwell', pill_id: 'p1', value: { ms: 4200 } });
    lifecycle.hide();
    await flushed();
    expect(sent).toEqual([{ events: [expect.objectContaining({ id: 'e1', value: { ms: 4200 } })], keepalive: true }]);
  });

  it('retries a failed send with the same ids, waiting longer each time', async () => {
    let fail = 2;
    const send = vi.fn(async () => {
      if (fail-- > 0) throw new ApiError({ status: 503, code: 'http_503', message: 'down' });
    });
    const { queue, timers } = setup({ send, retry: { baseMs: 100, maxMs: 1000 } });
    await queue.ready;
    queue.push({ kind: 'seen', pill_id: 'p1' });
    await queue.flush();
    expect(timers.due()).toEqual([100]);
    timers.run();
    await flushed();
    expect(timers.due()).toEqual([200]);
    timers.run();
    await flushed();
    expect(send).toHaveBeenCalledTimes(3);
    const ids = send.mock.calls.map((call) => (call as unknown as [PillEvent[]])[0].map((e) => e.id));
    expect(ids).toEqual([['e1'], ['e1'], ['e1']]);
    expect(queue.pending()).toEqual([]);
  });

  it('drops a batch the server refuses for good instead of retrying forever', async () => {
    const send = vi.fn(async () => {
      throw new ApiError({ status: 422, code: 'invalid', message: 'bad' });
    });
    const { queue, timers } = setup({ send });
    await queue.ready;
    queue.push({ kind: 'seen', pill_id: 'p1' });
    await queue.flush();
    expect(queue.pending()).toEqual([]);
    expect(timers.due()).toEqual([]);
  });

  it('sends what an earlier visit left behind, keeping events pushed meanwhile', async () => {
    const left: PillEvent = { id: 'old', kind: 'save', pill_id: 'p0', at: '2026-10-05T08:00:00Z' };
    const storage = memoryStorage({ [EVENTS_STORAGE_KEY]: JSON.stringify([left]) });
    const { queue, sent, timers } = setup({ storage });
    queue.push({ kind: 'seen', pill_id: 'p1' });
    await queue.ready;
    expect(queue.pending().map((e) => e.id)).toEqual(['old', 'e1']);
    expect(JSON.parse(storage.snapshot()[EVENTS_STORAGE_KEY]!).map((e: PillEvent) => e.id)).toEqual(['old', 'e1']);
    expect(timers.due()).toEqual([0]);
    timers.run();
    await flushed();
    expect(sent[0]!.events.map((e) => e.id)).toEqual(['old', 'e1']);
  });

  it('keeps one request in flight and stops listening once disposed', async () => {
    let release: () => void = () => undefined;
    const send = vi.fn(() => new Promise<void>((resolve) => (release = resolve)));
    const { queue, lifecycle, timers } = setup({ send });
    await queue.ready;
    queue.push({ kind: 'seen', pill_id: 'p1' });
    const a = queue.flush();
    const b = queue.flush();
    expect(a).toBe(b);
    release();
    await a;
    expect(send).toHaveBeenCalledTimes(1);
    queue.dispose();
    queue.push({ kind: 'seen', pill_id: 'p2' });
    lifecycle.hide();
    expect(timers.due()).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('helpers', () => {
  it('backs off by doubling up to the cap', () => {
    const retry = { baseMs: 1000, maxMs: 5000 };
    expect([1, 2, 3, 4].map((n) => backoffMs(n, retry))).toEqual([1000, 2000, 4000, 5000]);
  });

  it('retries network trouble, throttling and server errors only', () => {
    expect(isRetryableError(new Error('offline'))).toBe(true);
    expect([0, 408, 429, 500, 503].every((status) => isRetryableError({ status }))).toBe(true);
    expect([400, 404, 422].some((status) => isRetryableError({ status }))).toBe(false);
  });

  it('makes v4 uuids', () => {
    expect(newEventId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

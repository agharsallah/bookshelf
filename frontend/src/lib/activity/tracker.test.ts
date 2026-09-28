import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/errors';
import type { Entry } from './log';
import { ActivityTracker, IDLE_MS, TICK_MS } from './tracker';

function setup(options: { visible?: boolean; fail?: unknown } = {}) {
  let now = Date.UTC(2026, 8, 28, 9, 0, 0);
  const sent: Entry[][] = [];
  const post = vi.fn(async (_path: string, body: unknown) => {
    if (options.fail) throw options.fail;
    sent.push((body as { entries: Entry[] }).entries);
    return {};
  });
  const tracker = new ActivityTracker({ api: { post } as never, now: () => now, visible: () => options.visible ?? true });
  const advance = (ms: number) => {
    for (let t = 0; t < ms; t += TICK_MS) {
      now += TICK_MS;
      tracker.tick();
    }
  };
  return { tracker, advance, sent, post };
}

const read = { surface: 'read' as const, document: 'book', unit: 'ch01', anchor: 'ch01/p001' };
const total = (entries: Entry[][]) => entries.flat().reduce((sum, e) => sum + e.seconds, 0);

describe('ActivityTracker', () => {
  it('counts the time the watched place is on screen', async () => {
    const { tracker, advance, sent } = setup();
    tracker.watch(read);
    advance(30_000);

    await tracker.flush();

    expect(total(sent)).toBe(30);
    expect(sent[0]?.[0]).toMatchObject(read);
  });

  it('stops counting when you have not touched the page for a while', async () => {
    const { tracker, advance, sent } = setup();
    tracker.watch(read);
    advance(IDLE_MS + 60_000);

    await tracker.flush();

    expect(total(sent)).toBe(IDLE_MS / 1000);
  });

  it('counts nothing while the page is hidden', async () => {
    const { tracker, advance, sent } = setup({ visible: false });
    tracker.watch(read);
    advance(30_000);

    await tracker.flush();

    expect(sent).toEqual([]);
  });

  it('credits the latest watch, and the previous one again once it goes', async () => {
    const { tracker, advance, sent } = setup();
    tracker.watch(read);
    advance(10_000);
    const stop = tracker.watch({ surface: 'study', document: 'book', detail: 'quiz' });
    advance(20_000);
    stop();
    advance(5_000);

    await tracker.flush();

    const bySurface = Object.fromEntries(['read', 'study'].map((s) => [s, sent.flat().filter((e) => e.surface === s).reduce((n, e) => n + e.seconds, 0)]));
    expect(bySurface).toEqual({ read: 15, study: 20 });
  });

  it('counts audio directly, watched or not', async () => {
    const { tracker, sent } = setup({ visible: false });
    tracker.count({ surface: 'listen', document: 'book', unit: 'ch01' }, 12);

    await tracker.flush();

    expect(sent.flat()).toMatchObject([{ surface: 'listen', seconds: 12 }]);
  });

  it('keeps what a network failure did not deliver for the next flush', async () => {
    const failing = setup({ fail: new TypeError('offline') });
    failing.tracker.count(read, 20);
    await failing.tracker.flush();
    await failing.tracker.flush();

    expect(failing.post).toHaveBeenCalledTimes(2);
    expect(failing.post.mock.calls[1]?.[1]).toMatchObject({ entries: [{ seconds: 20 }] });
  });

  it('drops a batch the server refused', async () => {
    const refused = setup({ fail: new ApiError({ status: 422, code: 'validation_error', message: 'bad clock' }) });
    refused.tracker.count(read, 20);
    await refused.tracker.flush();
    await refused.tracker.flush();

    expect(refused.post).toHaveBeenCalledTimes(1);
  });
});

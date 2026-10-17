import { describe, expect, it, vi } from 'vitest';
import { trackUpstream, upstreamFetch } from './upstream';

const reply = (...statuses: (number | Error)[]) => {
  const fetch = vi.fn(async () => {
    const next = statuses.shift() ?? 200;
    if (next instanceof Error) throw next;
    return new Response(null, { status: next });
  });
  return fetch as unknown as typeof globalThis.fetch & typeof fetch;
};

describe('upstreamFetch', () => {
  it('tries a GET once more when the backend is not ready yet', async () => {
    const base = reply(502, 200);
    const { result, failed } = await trackUpstream(() => upstreamFetch(base, [0])('https://api/x'));
    expect(result.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(failed).toBe(false);
  });

  it('retries a network error too, and notes what still failed', async () => {
    const base = reply(new TypeError('fetch failed'), 503);
    const { result, failed } = await trackUpstream(() => upstreamFetch(base, [0])('https://api/x'));
    expect(result.status).toBe(503);
    expect(failed).toBe(true);
  });

  it('never repeats a write', async () => {
    const base = reply(502);
    const { result, failed } = await trackUpstream(() => upstreamFetch(base, [0])('https://api/x', { method: 'POST' }));
    expect([result.status, base.mock.calls.length, failed]).toEqual([502, 1, true]);
  });

  it('keeps one request apart from another', async () => {
    const bad = trackUpstream(() => upstreamFetch(reply(500), [0])('https://api/a'));
    const good = trackUpstream(() => upstreamFetch(reply(200), [0])('https://api/b'));
    expect([(await bad).failed, (await good).failed]).toEqual([true, false]);
  });

  it('notes nothing for a 404, which is an answer', async () => {
    const { failed } = await trackUpstream(() => upstreamFetch(reply(404), [0])('https://api/x'));
    expect(failed).toBe(false);
  });

  it('waits out a sleeping instance with a longer schedule', async () => {
    const base = reply(502, new TypeError('fetch failed'), 503, 200);
    const { result, failed } = await trackUpstream(() => upstreamFetch(base, [0, 0, 0, 0])('https://api/x'));
    expect([result.status, base.mock.calls.length, failed]).toEqual([200, 4, false]);
  });
});

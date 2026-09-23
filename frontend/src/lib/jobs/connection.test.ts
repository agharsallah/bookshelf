import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../api/types/jobs';
import { backoffDelay, connectJobStream, type ConnectionEvent, type EventSourceLike } from './connection';

class FakeSource implements EventSourceLike {
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data = '') {
    (this.listeners.get(type) ?? []).forEach((l) => l({ data } as MessageEvent<string>));
  }
}

/** Timers the test fires by hand, recording each requested delay. */
function manualTimers() {
  const pending: { fn: () => void; ms: number }[] = [];
  return {
    delays: () => pending.map((p) => p.ms),
    fire: () => pending.splice(0).forEach((p) => p.fn()),
    timers: { set: (fn: () => void, ms: number) => pending.push({ fn, ms }), clear: () => pending.splice(0) },
  };
}

function setup() {
  const sources: FakeSource[] = [];
  const jobs: JobPublic[] = [];
  const statuses: ConnectionEvent[] = [];
  const clock = manualTimers();
  const stop = connectJobStream({
    url: '/api/jobs/stream',
    create: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    timers: clock.timers,
    onJob: (job) => jobs.push(job),
    onStatus: (event) => statuses.push(event),
  });
  const current = () => sources.at(-1)!;
  return { sources, jobs, statuses, clock, stop, current };
}

describe('backoffDelay', () => {
  it.each([
    [0, 1000],
    [1, 2000],
    [3, 8000],
    [10, 30_000],
  ])('attempt %i waits %i ms', (attempt, ms) => {
    expect(backoffDelay(attempt)).toBe(ms);
  });
});

describe('connectJobStream', () => {
  it('passes jobs through and drops frames that are not jobs', () => {
    const { current, jobs } = setup();
    current().emit('job', '{"id":"j1","kind":"parse","state":"running"}');
    current().emit('job', 'not json');
    expect(jobs.map((j) => j.id)).toEqual(['j1']);
  });

  it('after a shutdown end, reconnects with a growing backoff that resets once a connection opens', () => {
    const { sources, clock, current, statuses } = setup();
    current().emit('end', '{"reason":"shutdown"}');
    expect(sources[0]?.closed).toBe(true);
    expect(clock.delays()).toEqual([1000]);
    clock.fire();
    current().emit('error');
    expect(clock.delays()).toEqual([2000]);
    clock.fire();
    current().emit('open');
    current().emit('error');
    expect([sources.length, clock.delays()]).toEqual([3, [1000]]);
    expect(statuses).toEqual(['end', 'error', 'open', 'error']);
  });

  it('reconnects at once after the routine max_seconds end', () => {
    const { clock, current } = setup();
    current().emit('end', '{"reason":"max_seconds"}');
    expect(clock.delays()).toEqual([0]);
  });

  it('stops for good: no reconnect is pending and the source is closed', () => {
    const { clock, current, stop, sources } = setup();
    current().emit('error');
    stop();
    clock.fire();
    expect([sources.length, sources[0]?.closed, clock.delays()]).toEqual([1, true, []]);
  });
});

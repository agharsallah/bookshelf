import { describe, expect, it, vi } from 'vitest';
import type { JobPublic, QueueStatus } from '../api/types/jobs';
import type { JobStreamConnection } from './connection';
import { subscribeJobStream, type JobStreamListener } from './shared';

const job = { id: 'j1', state: 'running', attempts: 1, created_at: '2026-09-26T10:00:00Z', started_at: '2026-09-26T10:00:01Z' } as JobPublic;
const status: QueueStatus = { workers: [], queued: 0, running: 1, unclaimed_kinds: [], paused: false, max_running: null, slots: 2 };

function listener(): JobStreamListener & { seen: string[] } {
  const seen: string[] = [];
  return { seen, onJob: (j) => seen.push(`job:${j.id}`), onQueue: () => seen.push('queue'), onStatus: (e) => seen.push(e) };
}

describe('subscribeJobStream', () => {
  it('shares one connection, replays what it saw to late subscribers, and closes with the last', () => {
    let options: JobStreamConnection | undefined;
    const close = vi.fn();
    const connect = vi.fn((o: JobStreamConnection) => {
      options = o;
      return close;
    });

    const first = listener();
    const stopFirst = subscribeJobStream('/stream', first, connect);
    options!.onStatus('open');
    options!.onJob(job);
    options!.onQueue!(status);

    const late = listener();
    const stopLate = subscribeJobStream('/stream', late, connect);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(first.seen).toEqual(['open', 'job:j1', 'queue']);
    expect(late.seen).toEqual(['job:j1', 'queue', 'open']);

    stopFirst();
    expect(close).not.toHaveBeenCalled();
    stopLate();
    expect(close).toHaveBeenCalledTimes(1);
  });
});

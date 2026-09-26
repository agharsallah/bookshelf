import { describe, expect, it } from 'vitest';
import type { JobPublic, QueueStatus } from '../api/types/jobs';
import { artifactOf, describeJob, latestJob, placeInLine } from './progress';

const NOW = Date.parse('2026-09-26T10:00:00Z');

function job(overrides: Partial<JobPublic> = {}): JobPublic {
  return {
    id: 'j1', kind: 'derive', document_id: 'd1', anchor: 'ch01', skill: 'make-faq', skill_version: '2',
    state: 'queued', attempts: 0, error: null, result: null, run_mode: null, duration_ms: null,
    created_at: '2026-09-26T09:59:00Z', started_at: null, finished_at: null, run_after: '2026-09-26T09:59:00Z',
    queue_position: 1, ...overrides,
  };
}

const queue = (unclaimed: QueueStatus['unclaimed_kinds'] = []): QueueStatus => ({ workers: [], queued: 1, running: 0, unclaimed_kinds: unclaimed });

describe('describeJob', () => {
  it('gives a queued job its place in line', () => {
    expect(describeJob(job({ queue_position: 3 }), NOW, queue())).toEqual({ phase: 'waiting', text: 'Queued, 3rd in line', live: true });
  });

  it('says when no worker will pick a queued job up', () => {
    expect(describeJob(job(), NOW, queue(['derive'])).phase).toBe('stalled');
    expect(describeJob(job(), NOW, queue(['parse'])).phase).toBe('waiting');
  });

  it('counts down a retry backoff', () => {
    const retrying = job({ attempts: 1, run_after: '2026-09-26T10:01:30Z' });
    expect(describeJob(retrying, NOW)).toEqual({ phase: 'backoff', text: 'Retrying in 1 min 30 s', live: true });
  });

  it('shows how long a job has run, and which attempt it is', () => {
    const running = job({ state: 'running', attempts: 2, started_at: '2026-09-26T09:59:18Z' });
    expect(describeJob(running, NOW).text).toBe('Running · 42 s · attempt 2');
  });

  it('tells a cancelled job from one that had nothing to do', () => {
    expect(describeJob(job({ state: 'skipped', error: 'cancelled by user' }), NOW).text).toBe('Cancelled');
    expect(describeJob(job({ state: 'skipped' }), NOW)).toEqual({ phase: 'skipped', text: 'Up to date', live: false });
  });
});

describe('placeInLine', () => {
  it('uses English ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(placeInLine)).toEqual([
      'next in line', '2nd in line', '3rd in line', '4th in line', '11th in line', '12th in line', '13th in line', '21st in line', '22nd in line', '101st in line',
    ]);
  });
});

describe('latestJob and artifactOf', () => {
  it('picks the newest matching job and reads the artifact it made', () => {
    const old = job({ id: 'a', created_at: '2026-09-26T09:00:00Z', state: 'failed' });
    const fresh = job({ id: 'b', state: 'done', result: { artifact_id: 'art-1' } });
    const other = job({ id: 'c', skill: 'make-quiz', created_at: '2026-09-26T09:59:59Z' });
    const found = latestJob({ a: old, b: fresh, c: other }, (j) => j.skill === 'make-faq');
    expect(found?.id).toBe('b');
    expect(artifactOf(fresh)).toBe('art-1');
    expect(artifactOf(old)).toBeNull();
  });
});

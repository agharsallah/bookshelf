import { describe, expect, it } from 'vitest';
import type { Job } from '../api/types/jobs';
import { initialJobStreamState, jobStreamReducer, parseJobEvent, sortedJobs } from './stream';

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j1',
    kind: 'parse',
    document_id: 'd1',
    anchor: null,
    skill: null,
    skill_version: null,
    state: 'queued',
    attempts: 0,
    error: null,
    result: null,
    run_mode: null,
    duration_ms: null,
    created_at: '2026-09-23T10:00:00Z',
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

const apply = (...events: Parameters<typeof jobStreamReducer>[1][]) =>
  events.reduce(jobStreamReducer, initialJobStreamState);

describe('jobStreamReducer', () => {
  it('keeps the latest state of each job', () => {
    const state = apply(
      { type: 'job', job: job({ state: 'queued' }) },
      { type: 'job', job: job({ state: 'running', attempts: 1 }) },
      { type: 'job', job: job({ state: 'done', attempts: 1 }) },
    );
    expect(state.jobs.j1?.state).toBe('done');
  });

  it('ignores a replayed older event after a reconnect', () => {
    const state = apply(
      { type: 'job', job: job({ state: 'done', attempts: 1 }) },
      { type: 'job', job: job({ state: 'running', attempts: 1 }) },
    );
    expect(state.jobs.j1?.state).toBe('done');
  });

  it('accepts a retry that goes back to queued with more attempts', () => {
    const state = apply(
      { type: 'job', job: job({ state: 'failed', attempts: 1 }) },
      { type: 'job', job: job({ state: 'queued', attempts: 2 }) },
    );
    expect(state.jobs.j1).toMatchObject({ state: 'queued', attempts: 2 });
  });

  it('ignores an event from an earlier attempt', () => {
    const state = apply(
      { type: 'job', job: job({ state: 'queued', attempts: 2 }) },
      { type: 'job', job: job({ state: 'failed', attempts: 1 }) },
    );
    expect(state.jobs.j1).toMatchObject({ state: 'queued', attempts: 2 });
  });

  it('tracks the connection: open is live, error and end are reconnecting', () => {
    expect(apply({ type: 'open' }).status).toBe('live');
    expect(apply({ type: 'open' }, { type: 'error' }).status).toBe('reconnecting');
    expect(apply({ type: 'open' }, { type: 'end' }).status).toBe('reconnecting');
  });
});

describe('parseJobEvent', () => {
  it('reads a job payload', () => {
    expect(parseJobEvent(JSON.stringify(job({ state: 'running' })))?.state).toBe('running');
  });

  it.each(['not json', '{"reason":"max_seconds"}', 'null'])('drops %s', (data) => {
    expect(parseJobEvent(data)).toBeNull();
  });
});

describe('sortedJobs', () => {
  it('lists newest first, filtered', () => {
    const jobs = {
      a: job({ id: 'a', created_at: '2026-01-01T00:00:00Z' }),
      b: job({ id: 'b', created_at: '2026-03-01T00:00:00Z' }),
      c: job({ id: 'c', created_at: '2026-02-01T00:00:00Z', kind: 'summarize' }),
    };
    expect(sortedJobs(jobs).map((j) => j.id)).toEqual(['b', 'c', 'a']);
    expect(sortedJobs(jobs, (j) => j.kind === 'parse').map((j) => j.id)).toEqual(['b', 'a']);
  });
});

import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { liveJobFor } from './queue';

const job = (overrides: Partial<JobPublic>): JobPublic => ({
  id: 'j1',
  kind: 'derive',
  document_id: 'd1',
  anchor: null,
  skill: 'simplify-paper',
  skill_version: '1',
  payload: { params: { level: 'expert' } },
  state: 'queued',
  attempts: 0,
  error: null,
  result: null,
  run_mode: 'batch',
  duration_ms: null,
  created_at: '2026-09-28T10:00:00Z',
  started_at: null,
  finished_at: null,
  ...overrides,
});

const expert = { kind: 'derive' as const, document_id: 'd1', skill: 'simplify-paper', params: { level: 'expert' } };

describe('liveJobFor', () => {
  it('finds the newest live job with the same skill and level', () => {
    const jobs = [job({ id: 'old' }), job({ id: 'new', state: 'running', created_at: '2026-09-28T11:00:00Z' })];
    expect(liveJobFor(jobs, expert)?.id).toBe('new');
  });

  it('ignores finished jobs, other levels, other skills and other documents', () => {
    const jobs = [
      job({ state: 'done' }),
      job({ payload: { params: { level: 'newcomer' } } }),
      job({ skill: 'make-quiz' }),
      job({ document_id: 'd2' }),
    ];
    expect(liveJobFor(jobs, expert)).toBeNull();
  });

  it('matches a stage job by kind alone', () => {
    expect(liveJobFor([job({ kind: 'dissect_paper', skill: null, payload: {} })], { kind: 'dissect_paper', document_id: 'd1' })?.id).toBe('j1');
  });
});

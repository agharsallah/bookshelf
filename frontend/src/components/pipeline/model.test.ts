import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { countStates, elapsedMs, filterJobs, formatDuration, isRunCeiling, retrySpec, stageProgress } from './model';

function job(overrides: Partial<JobPublic> = {}): JobPublic {
  return {
    id: 'j1',
    kind: 'parse',
    document_id: 'd1',
    anchor: null,
    skill: null,
    skill_version: null,
    state: 'done',
    attempts: 1,
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

const states = (status: string, jobs: JobPublic[]) => stageProgress(status, jobs).map((s) => `${s.stage.key}:${s.state}`);

describe('stageProgress', () => {
  it('follows a document that is distilling: parse and enrich done, distil active', () => {
    expect(
      states('distilling', [job({ kind: 'parse' }), job({ kind: 'summarize' }), job({ kind: 'distil_section', state: 'running' })]),
    ).toEqual(['parse:done', 'enrich:done', 'distil:active', 'brief:waiting', 'index:waiting', 'link:waiting', 'derive:waiting']);
  });

  it('marks a stage failed when a job failed and nothing is live', () => {
    expect(states('enriching', [job({ kind: 'describe_figure', state: 'failed' })])[1]).toBe('enrich:failed');
  });

  it('keeps a stage active while a retry is queued, even after a failure', () => {
    expect(
      states('enriching', [job({ kind: 'explain_code', state: 'failed' }), job({ id: 'j2', kind: 'explain_code', state: 'queued' })])[1],
    ).toBe('enrich:active');
  });

  it('reads a failed parse from the document status', () => {
    expect(states('parse_failed', [])[0]).toBe('parse:failed');
  });

  it('counts a stage done from the document status even without jobs in view', () => {
    expect(states('indexed', []).slice(0, 5)).toEqual(['parse:done', 'enrich:done', 'distil:done', 'brief:done', 'index:done']);
  });
});

describe('countStates', () => {
  it('tallies jobs by state', () => {
    expect(countStates([job(), job({ state: 'failed' }), job({ state: 'failed' })])).toEqual({ queued: 0, running: 0, done: 1, failed: 2, skipped: 0 });
  });
});

describe('elapsedMs', () => {
  const now = Date.parse('2026-09-23T10:01:30Z');

  it('measures a running job from its start to now', () => {
    expect(elapsedMs(job({ state: 'running', started_at: '2026-09-23T10:00:00Z' }), now)).toBe(90_000);
  });

  it('uses the recorded duration of a finished job', () => {
    expect(elapsedMs(job({ duration_ms: 1234 }), now)).toBe(1234);
  });

  it('is unknown for a queued job', () => {
    expect(elapsedMs(job({ state: 'queued' }), now)).toBeNull();
  });
});

describe('formatDuration', () => {
  it.each([
    [850, '850 ms'],
    [12_400, '12 s'],
    [184_000, '3 min 04 s'],
    [3_720_000, '1 h 02 min'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatDuration(ms)).toBe(text);
  });
});

describe('retry and run ceiling', () => {
  it('retries the same kind and scope', () => {
    expect(retrySpec(job({ kind: 'distil_chapter', anchor: 'ch03', state: 'failed' }))).toEqual({ kind: 'distil_chapter', document_id: 'd1', anchor: 'ch03' });
  });

  it.each(['derive', 'structure_note'] as const)('cannot retry %s, whose skill or note POST /jobs cannot name', (kind) => {
    expect(retrySpec(job({ kind }))).toBeNull();
  });

  it('recognises the run-ceiling failure', () => {
    expect(isRunCeiling(job({ error: 'run ceiling reached: 400 skill runs for this document' }))).toBe(true);
    expect(isRunCeiling(job({ error: 'schema: <root>: bad' }))).toBe(false);
  });
});

describe('filterJobs', () => {
  it('narrows by state, kind and document', () => {
    const jobs = [job({ id: 'a' }), job({ id: 'b', state: 'failed', kind: 'embed' }), job({ id: 'c', document_id: 'd2' })];
    expect(filterJobs(jobs, { state: 'failed' }).map((j) => j.id)).toEqual(['b']);
    expect(filterJobs(jobs, { kind: 'parse', document: 'd2' }).map((j) => j.id)).toEqual(['c']);
  });
});

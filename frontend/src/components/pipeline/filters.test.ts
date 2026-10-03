import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { activeDocumentIds, filtersFromSearch, filtersToSearch, filterJobs, hasFilters } from './filters';

function job(overrides: Partial<JobPublic> = {}): JobPublic {
  return {
    id: 'j1', kind: 'parse', document_id: 'd1', anchor: null, skill: null, skill_version: null, state: 'done', attempts: 1,
    error: null, result: null, run_mode: null, duration_ms: null, created_at: '2026-09-23T10:00:00Z', started_at: null, finished_at: null,
    ...overrides,
  };
}

const TITLES: Record<string, string> = { d1: 'Attention Is All You Need', d2: 'Designing Data-Intensive Applications' };
const titleOf = (j: JobPublic) => TITLES[j.document_id ?? ''] ?? '';
const ids = (jobs: JobPublic[]) => jobs.map((j) => j.id);

describe('filterJobs', () => {
  const jobs = [
    job({ id: 'a' }),
    job({ id: 'b', state: 'failed', kind: 'embed' }),
    job({ id: 'c', document_id: 'd2', kind: 'derive', skill: 'make-quiz', anchor: 'ch03' }),
  ];

  it('narrows by state, kind and document', () => {
    expect(ids(filterJobs(jobs, { state: 'failed' }))).toEqual(['b']);
    expect(ids(filterJobs(jobs, { kind: 'derive', document: 'd2' }))).toEqual(['c']);
  });

  it('finds jobs by every word of the text, in the title, kind label or skill, ignoring case', () => {
    expect(ids(filterJobs(jobs, { q: 'ATTENTION embed' }, titleOf))).toEqual(['b']);
    expect(ids(filterJobs(jobs, { q: 'data quiz' }, titleOf))).toEqual(['c']);
    expect(ids(filterJobs(jobs, { q: '  ' }, titleOf))).toEqual(['a', 'b', 'c']);
    expect(ids(filterJobs(jobs, { q: 'nothing like this' }, titleOf))).toEqual([]);
  });
});

describe('filters in the URL', () => {
  it('round-trips the filters, dropping empty ones and keeping other parameters', () => {
    const search = filtersToSearch({ state: 'failed', kind: '', document: 'd1', q: ' quiz ' }, new URLSearchParams('tab=x&kind=parse'));
    expect(search.toString()).toBe('tab=x&state=failed&document=d1&q=quiz');
    expect(filtersFromSearch(search)).toEqual({ state: 'failed', kind: '', document: 'd1', q: 'quiz' });
  });

  it('ignores a state or kind it does not know', () => {
    expect(filtersFromSearch(new URLSearchParams('state=lost&kind=nope'))).toMatchObject({ state: '', kind: '' });
  });

  it('knows when any filter is set', () => {
    expect(hasFilters({ state: '', q: ' ' })).toBe(false);
    expect(hasFilters({ q: 'x' })).toBe(true);
  });
});

describe('activeDocumentIds', () => {
  it('counts documents with live or failed work, not finished ones', () => {
    const jobs = [job({ document_id: 'd1', state: 'done' }), job({ document_id: 'd2', state: 'failed' }), job({ document_id: 'd3', state: 'queued' }), job({ document_id: null, state: 'running' })];
    expect([...activeDocumentIds(jobs)].sort()).toEqual(['d2', 'd3']);
  });
});

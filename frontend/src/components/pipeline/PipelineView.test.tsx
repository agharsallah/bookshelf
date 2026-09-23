import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';
import { PipelineView } from './PipelineView';

function job(overrides: Partial<JobPublic>): JobPublic {
  return {
    id: 'j1', kind: 'parse', document_id: 'd1', anchor: null, skill: null, skill_version: null, state: 'done', attempts: 1,
    error: null, result: null, run_mode: null, duration_ms: 10, created_at: '2026-09-23T10:00:00Z', started_at: null, finished_at: '2026-09-23T10:00:01Z',
    ...overrides,
  };
}

const failed = job({ id: 'f1', kind: 'distil_chapter', anchor: 'ch03', state: 'failed', error: 'run ceiling reached: 400 skill runs' });

describe('<PipelineView>', () => {
  it('retries a failed job with the same kind and scope, and surfaces the run ceiling', async () => {
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: { ...failed, id: 'f2', state: 'queued', attempts: 0 }, deduplicated: false }) });
    render(<PipelineView jobs={[job({}), failed]} documents={[{ id: 'd1', slug: 'd', title: 'Systems', status: 'distilling' }]} api={api} live={false} />);

    expect(screen.getByRole('alert').textContent).toMatch(/Run ceiling reached/);
    const failures = screen.getByRole('region', { name: /Failed/ });
    await userEvent.click(within(failures).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: 'jobs', body: { kind: 'distil_chapter', document_id: 'd1', anchor: 'ch03' } }]));
    expect(within(failures).getByText('Queued again.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: /Running and queued/ })).getByText('Distil chapter')).toBeTruthy();
  });

  it('filters the lists by state from the tallies', async () => {
    render(<PipelineView jobs={[job({}), failed]} documents={[]} api={fakeApi().api} live={false} />);
    await userEvent.click(screen.getByRole('button', { name: /1 failed/ }));
    expect(screen.getByText('Nothing finished yet.')).toBeTruthy();
  });
});

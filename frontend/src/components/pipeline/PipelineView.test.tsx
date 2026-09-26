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

const failed = job({ id: 'f1', kind: 'derive', anchor: 'ch03', skill: 'make-quiz', state: 'failed', error: 'schema: <root>: bad' });
const queued = job({ id: 'q1', kind: 'summarize', anchor: 'ch04', state: 'queued', finished_at: null });
const systems = { id: 'd1', slug: 'systems', title: 'Systems', status: 'distilling' };
const paused = { reason: '400 skill runs reached the ceiling of 400', at: '2026-09-23T10:00:00Z', runs: 400, limit: 400 };

describe('<PipelineView>', () => {
  it('retries a failed job through its retry endpoint and lists the new one as queued', async () => {
    const { api, calls } = fakeApi({ 'POST jobs/f1/retry': () => ({ job: { ...failed, id: 'f2', state: 'queued', attempts: 0 }, deduplicated: false }) });
    render(<PipelineView jobs={[job({}), failed]} documents={[systems]} api={api} live={false} />);

    const failures = screen.getByRole('region', { name: /Failed/ });
    await userEvent.click(within(failures).getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: 'jobs/f1/retry', body: undefined }]));
    expect(within(failures).getByText('Queued again.')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: /Running and queued/ })).getByText('Make a quiz')).toBeTruthy();
  });

  it('cancels a queued job, which then leaves the running list', async () => {
    const { api, calls } = fakeApi({ 'DELETE jobs/q1': () => ({ ...queued, state: 'skipped', error: 'cancelled by user' }) });
    render(<PipelineView jobs={[queued]} documents={[systems]} api={api} live={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel Summarize for Systems' }));

    await waitFor(() => expect(calls).toEqual([{ method: 'DELETE', path: 'jobs/q1' }]));
    expect(screen.getByText(/Nothing is running/)).toBeTruthy();
  });

  it('shows a paused document from its own state and resumes it, requeueing what the ceiling stopped', async () => {
    const stopped = job({ id: 's1', kind: 'distil_chapter', state: 'failed', error: 'run ceiling reached' });
    const { api, calls } = fakeApi({ 'POST documents/systems/resume': () => ({ document: {}, requeued: [{ ...stopped, id: 's2', state: 'queued' }] }) });
    render(<PipelineView jobs={[stopped]} documents={[{ ...systems, paused }]} api={api} live={false} />);

    const notice = screen.getByRole('region', { name: 'Systems is paused' });
    expect(notice.textContent).toMatch(/400 skill runs reached the ceiling of 400\./);
    expect(within(screen.getByRole('region', { name: /Failed/ })).queryByRole('button', { name: 'Retry' })).toBeNull();
    await userEvent.click(within(notice).getByRole('button', { name: 'Resume' }));

    await waitFor(() => expect(calls).toEqual([{ method: 'POST', path: 'documents/systems/resume', body: {} }]));
    expect(screen.queryByRole('region', { name: 'Systems is paused' })).toBeNull();
    expect(within(screen.getByRole('region', { name: /Running and queued/ })).getByText('Distil chapter')).toBeTruthy();
  });

  it('filters the lists by state from the tallies', async () => {
    render(<PipelineView jobs={[job({}), failed]} documents={[]} api={fakeApi().api} live={false} />);
    await userEvent.click(screen.getByRole('button', { name: /1 failed/ }));
    expect(screen.getByText('Nothing finished yet.')).toBeTruthy();
  });
});

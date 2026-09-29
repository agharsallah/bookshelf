// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import type { SkillPublic } from '../../lib/api/types/skills';
import { fakeApi } from '../review/testing/fakeApi';
import { DeriveButton } from './DeriveButton';

vi.mock('./toast', () => ({ toast: vi.fn() }));
afterEach(cleanup);

const NOW = Date.parse('2026-09-26T10:00:00Z');
const skill = { name: 'make-faq', description: 'FAQ', job_kind: 'derive', artifact_type: 'faq' } as SkillPublic;

function job(overrides: Partial<JobPublic> = {}): JobPublic {
  return {
    id: 'j1', kind: 'derive', document_id: 'd1', anchor: null, skill: 'make-faq', skill_version: '2', state: 'queued',
    attempts: 0, error: null, result: null, run_mode: null, duration_ms: null, created_at: '2026-09-26T09:59:00Z',
    started_at: null, finished_at: null, run_after: '2026-09-26T09:59:00Z', queue_position: 2, ...overrides,
  };
}

const props = { skill, documentId: 'd1', anchor: null, queue: null, now: NOW, onJob: () => undefined };

describe('<DeriveButton>', () => {
  it('queues the job once and hands it to the stream state', async () => {
    const onJob = vi.fn();
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job: job(), deduplicated: false }) });
    render(<DeriveButton {...props} job={undefined} onJob={onJob} api={api} />);

    fireEvent.click(screen.getByRole('button', { name: 'Write an FAQ' }));

    await waitFor(() => expect(onJob).toHaveBeenCalledWith(job()));
    expect(calls).toEqual([{ method: 'POST', path: 'jobs', body: { kind: 'derive', document_id: 'd1', anchor: null, force: false, skill: 'make-faq' } }]);
  });

  it('cannot be clicked again while its job is queued, and says where it is in line', () => {
    render(<DeriveButton {...props} job={job()} />);
    expect((screen.getByRole('button', { name: 'Write an FAQ' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Queued, 2nd in line')).toBeTruthy();
  });

  it('warns when no worker will run it', () => {
    render(<DeriveButton {...props} job={job()} queue={{ workers: [], queued: 1, running: 0, unclaimed_kinds: ['derive'], paused: false, max_running: null, slots: 2 }} />);
    expect(screen.getByText('Waiting: no worker is running')).toBeTruthy();
  });

  it('cancels a queued job', async () => {
    const onJob = vi.fn();
    const cancelled = job({ state: 'skipped', error: 'cancelled by user' });
    const { api, calls } = fakeApi({ 'DELETE jobs/j1': () => cancelled });
    render(<DeriveButton {...props} job={job()} onJob={onJob} api={api} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onJob).toHaveBeenCalledWith(cancelled));
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: 'jobs/j1' });
  });

  it('links to what a finished job made and offers a failed one again', () => {
    const { rerender } = render(<DeriveButton {...props} job={job({ state: 'done', result: { artifact_id: 'a1' } })} />);
    expect(screen.getByRole('link', { name: 'View' }).getAttribute('href')).toBe('/review/a1');

    rerender(<DeriveButton {...props} job={job({ state: 'failed', error: 'schema: bad\ntrace' })} />);
    expect((screen.getByRole('button', { name: 'Write an FAQ again' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('schema: bad')).toBeTruthy();
  });
});

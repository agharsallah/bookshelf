// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentActions } from './DocumentActions';

const enqueueJob = vi.hoisted(() => vi.fn());
vi.mock('../../lib/jobs/api', () => ({ enqueueJob, cancelJob: vi.fn() }));
vi.mock('./toast', () => ({ toast: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  enqueueJob.mockReset();
});

describe('<DocumentActions> re-runs', () => {
  it('asks before a re-parse and queues nothing when you say no', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    render(<DocumentActions documentId="d1" kinds={['parse']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Re-parse' }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('queues the re-parse once confirmed, and the brief without asking', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    enqueueJob.mockResolvedValue({ job: { id: 'j1' }, deduplicated: false });
    render(<DocumentActions documentId="d1" kinds={['parse', 'brief']} />);

    await userEvent.click(screen.getByRole('button', { name: 'Re-parse' }));
    expect(enqueueJob).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ kind: 'parse', document_id: 'd1' }));

    await userEvent.click(screen.getByRole('button', { name: 'Write the brief' }));
    expect(enqueueJob).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ kind: 'brief' }));
    expect(confirm).toHaveBeenCalledOnce();
  });
});

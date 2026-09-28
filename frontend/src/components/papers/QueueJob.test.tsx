import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';

const stream = vi.hoisted(() => ({ options: [] as unknown[], tracked: [] as unknown[] }));
vi.mock('../../lib/hooks/useJobStream', () => ({
  useJobStream: (options: unknown) => {
    stream.options.push(options);
    return { status: 'open', jobs: {}, queue: null, track: (job: unknown) => stream.tracked.push(job) };
  },
}));

const { QueueJob } = await import('./QueueJob');

describe('<QueueJob>', () => {
  it('queues the job once and follows it on the paper’s own stream', async () => {
    const job = { id: 'j1', kind: 'dissect_paper', document_id: 'd1' } as JobPublic;
    const { api, calls } = fakeApi({ 'POST jobs': () => ({ job }) });
    render(<QueueJob request={{ kind: 'dissect_paper', document_id: 'd1' }} label="Write the card now" api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Write the card now' }));

    expect(calls).toEqual([{ method: 'POST', path: 'jobs', body: { kind: 'dissect_paper', document_id: 'd1' } }]);
    expect(stream.tracked).toEqual([job]);
    expect(stream.options.at(-1)).toMatchObject({ documentId: 'd1', enabled: true });
  });
});

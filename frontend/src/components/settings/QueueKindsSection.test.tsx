import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { JOB_KINDS, type QueueStatus } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';
import { QueueKindsSection } from './QueueKindsSection';

const status: QueueStatus = {
  workers: [], queued: 0, running: 0, unclaimed_kinds: [], paused: false, max_running: null, slots: 2,
  kinds: { describe_figure: 'skip' }, first_documents: [], skippable_kinds: ['describe_figure', 'explain_code'], queued_kinds: {},
};

describe('<QueueKindsSection>', () => {
  it('lists every kind, queued or not, each linkable, with its mode', async () => {
    const { api } = fakeApi({ 'GET jobs/queue': () => status });
    render(<QueueKindsSection api={api} />);

    const groups = await screen.findAllByRole('group', { name: /: how it runs$/ });
    expect(groups).toHaveLength(JOB_KINDS.length);
    const figure = screen.getByRole('group', { name: 'Describe figure: how it runs' });
    expect(within(figure).getByRole('button', { name: 'Skip' }).getAttribute('aria-pressed')).toBe('true');
    expect(figure.closest('li')?.id).toBe('queue-kind-describe_figure');
  });

  it('saves a kind put on hold through the queue', async () => {
    const { api, calls } = fakeApi({ 'GET jobs/queue': () => status, 'PATCH jobs/queue': (call) => ({ ...status, kinds: { ...status.kinds, ...(call.body as { kinds: object }).kinds } }) });
    render(<QueueKindsSection api={api} />);

    const derive = await screen.findByRole('group', { name: 'Derive: how it runs' });
    await userEvent.click(within(derive).getByRole('button', { name: 'Hold' }));

    await waitFor(() => expect(within(derive).getByRole('button', { name: 'Hold' }).getAttribute('aria-pressed')).toBe('true'));
    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ kinds: { derive: 'hold' } }]);
  });
});

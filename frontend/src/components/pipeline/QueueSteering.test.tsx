import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { QueueStatus } from '../../lib/api/types/jobs';
import { fakeApi } from '../review/testing/fakeApi';
import { QueueSteering } from './QueueSteering';

const status: QueueStatus = {
  workers: [], queued: 15, running: 0, unclaimed_kinds: [], paused: false, max_running: null, slots: 2,
  kinds: {}, first_documents: [], skippable_kinds: ['describe_figure'], queued_kinds: { describe_figure: 12, embed: 3 },
};
const books = [{ id: 'd1', slug: 'attention', title: 'Attention Is All You Need', status: 'distilling' }];

/** The panel inside a parent that keeps the queue status the API answers, like the page does. */
function Steered({ api }: { api: ReturnType<typeof fakeApi>['api'] }) {
  const [queue, setQueue] = useState(status);
  return <QueueSteering queue={queue} documents={books} api={api} onChanged={setQueue} />;
}

function setup() {
  const { api, calls } = fakeApi({
    'PATCH jobs/queue': (call) => {
      const body = call.body as { kinds?: Record<string, string | null>; first_documents?: string[] };
      const kinds = Object.fromEntries(Object.entries({ ...status.kinds, ...body.kinds }).filter(([, m]) => m));
      return { ...status, kinds, first_documents: body.first_documents ?? status.first_documents };
    },
  });
  render(<Steered api={api} />);
  return { calls };
}

describe('<QueueSteering>', () => {
  it('is closed until opened, saying the pipeline keeps its own order', () => {
    setup();
    expect(screen.getByText('The pipeline’s own order')).toBeTruthy();
    expect((screen.getByText('Priorities').closest('details') as HTMLDetailsElement).open).toBe(false);
  });

  it('puts a kind first, then shows it as a chip that undoes it in one click', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByText('Priorities'));

    await userEvent.click(within(screen.getByRole('group', { name: 'Embed: how it runs' })).getByRole('button', { name: 'First' }));
    const chips = await screen.findByRole('list', { name: 'Active priorities' });
    expect(within(chips).getByText('Embed first')).toBeTruthy();

    await userEvent.click(within(chips).getByRole('button', { name: 'Undo: Embed first' }));

    await waitFor(() => expect(calls.map((c) => c.body)).toEqual([{ kinds: { embed: 'first' } }, { kinds: { embed: null } }]));
    expect(screen.queryByRole('list', { name: 'Active priorities' })).toBeNull();
  });

  it('offers Skip only for kinds whose stage moves on without them', async () => {
    setup();
    await userEvent.click(screen.getByText('Priorities'));

    const skip = (kind: string) => within(screen.getByRole('group', { name: `${kind}: how it runs` })).queryByRole('button', { name: 'Skip' });
    expect(skip('Describe figure')).toBeTruthy();
    expect(skip('Embed')).toBeNull();
  });

  it('groups kinds under their stage', async () => {
    setup();
    await userEvent.click(screen.getByText('Priorities'));

    expect(within(screen.getByRole('region', { name: 'Enrich' })).getByText('Describe figure')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Index' })).getByText('Embed')).toBeTruthy();
  });

  it('puts a book first from the list of books', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByText('Priorities'));

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Put a book first' }), 'd1');

    await waitFor(() => expect(calls.map((c) => c.body)).toEqual([{ first_documents: ['d1'] }]));
    expect(within(screen.getByRole('list', { name: 'Active priorities' })).getByText('Attention Is All You Need first')).toBeTruthy();
  });
});

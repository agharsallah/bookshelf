import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import type * as MermaidModule from '../../../lib/mermaid';
import { artifact } from '../fixtures';
import { fakeApi } from '../testing/fakeApi';
import { ReviewQueue } from './ReviewQueue';

vi.mock('../../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.resolve('<svg></svg>'),
}));
vi.mock('../../../lib/highlight', () => ({ highlightCode: () => Promise.resolve('<pre></pre>') }));

const items = [
  artifact({ id: 'first', anchor: 'ch01/s01', review: 'needs_review' }),
  artifact({ id: 'second', anchor: 'ch01/s02' }),
  artifact({ id: 'third', anchor: 'ch01/s03' }),
];

type Review = (call: { path: string; body?: unknown }) => unknown;

const answer: Review = (call) => {
  const { action } = call.body as { action: string };
  const review = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'draft';
  return { ...items.find((i) => i.id === call.path.split('/')[1]), review };
};

function setup(review: Review = answer) {
  const { api, calls } = fakeApi({ 'POST artifacts/*': review });
  const navigate = vi.fn();
  render(<ReviewQueue items={items} documents={[{ id: 'doc1', slug: 'doc', title: 'Systems' }]} headings={{}} skills={[]} api={api} navigate={navigate} />);
  const queue = screen.getByRole('navigation', { name: 'Queue' });
  const row = (anchorText: string) => within(queue).getByRole('button', { name: new RegExp(`Section note ${anchorText}`) });
  return { calls, navigate, queue, row, user: userEvent.setup() };
}

describe('<ReviewQueue>', () => {
  it('approving with "a" sends the review and moves focus to the next item', async () => {
    const { calls, row, user } = setup();
    await user.click(row('1.1'));
    await user.keyboard('a');
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: 'artifacts/first/review', body: { action: 'approve' } }));
    expect(document.activeElement).toBe(row('1.2'));
    expect(screen.queryByRole('button', { name: /Section note 1\.1/ })).toBeNull();
  });

  it('undo reopens a sent verdict and puts the item back as a draft', async () => {
    const { calls, row, user } = setup();
    await user.click(row('1.2'));
    await user.keyboard('r');
    expect(screen.queryByRole('button', { name: /Section note 1\.2/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(row('1.2')).toBeTruthy());
    expect(calls.map((c) => c.body)).toEqual([{ action: 'reject' }, { action: 'reopen' }]);
    // Focus follows once the restored item is back in the walk order (a render later).
    await waitFor(() => expect(document.activeElement).toBe(row('1.2')));
  });

  it('a refused reopen is reported and the item stays reviewed', async () => {
    const conflict = new ApiError({ status: 409, code: 'conflict', message: 'Another version now covers this input.' });
    const { row, user } = setup((call) => ((call.body as { action: string }).action === 'reopen' ? Promise.reject(conflict) : answer(call)));
    await user.click(row('1.3'));
    await user.keyboard('a');
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText(/Could not undo: Another version now covers this input\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Section note 1\.3/ })).toBeNull();
  });

  it('a refused verdict puts the item back and says why', async () => {
    const gone = new ApiError({ status: 404, code: 'not_found', message: 'Artifact first does not exist.' });
    const { row, user } = setup(() => Promise.reject(gone));
    await user.click(row('1.1'));
    await user.keyboard('a');

    expect(await screen.findByText(/Not approved: Artifact first does not exist\./)).toBeTruthy();
    expect(row('1.1')).toBeTruthy();
  });

  it('j/k walk the queue and Enter opens the focused item', async () => {
    const { navigate, row, user } = setup();
    await user.click(row('1.1'));
    await user.keyboard('jjk{Enter}');
    expect(navigate).toHaveBeenCalledWith('/review/second');
  });

  it('bulk approval only counts selected drafts that pass every gate', async () => {
    const { calls, queue, user } = setup();
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.1/ }));
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.3/ }));
    await user.click(screen.getByRole('button', { name: 'Approve 1' }));
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['artifacts/third/review']));
  });
});

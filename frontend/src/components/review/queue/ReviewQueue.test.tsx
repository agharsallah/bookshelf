import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

function setup(undoMs: number) {
  const { api, calls } = fakeApi({ 'POST artifacts/*': (call) => ({ ...items[0], id: call.path.split('/')[1], review: 'approved' }) });
  const navigate = vi.fn();
  render(<ReviewQueue items={items} documents={[{ id: 'doc1', slug: 'doc', title: 'Systems' }]} headings={{}} skills={[]} api={api} undoMs={undoMs} navigate={navigate} />);
  const queue = screen.getByRole('navigation', { name: 'Queue' });
  const row = (anchorText: string) => within(queue).getByRole('button', { name: new RegExp(`Section note ${anchorText}`) });
  return { calls, navigate, queue, row, user: userEvent.setup() };
}

describe('<ReviewQueue>', () => {
  it('approving with "a" sends the review and moves focus to the next item', async () => {
    const { calls, row, user } = setup(0);
    await user.click(row('1.1'));
    await user.keyboard('a');
    await waitFor(() => expect(calls).toContainEqual({ method: 'POST', path: 'artifacts/first/review', body: { action: 'approve' } }));
    expect(document.activeElement).toBe(row('1.2'));
    expect(screen.queryByRole('button', { name: /Section note 1\.1/ })).toBeNull();
  });

  it('undo inside the window keeps the request unsent and puts the item back', async () => {
    const { calls, row, user } = setup(60_000);
    await user.click(row('1.2'));
    await user.keyboard('r');
    expect(screen.queryByRole('button', { name: /Section note 1\.2/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(row('1.2')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('j/k walk the queue and Enter opens the focused item', async () => {
    const { navigate, row, user } = setup(0);
    await user.click(row('1.1'));
    await user.keyboard('jjk{Enter}');
    expect(navigate).toHaveBeenCalledWith('/review/second');
  });

  it('bulk approval only counts selected drafts that pass every gate', async () => {
    const { calls, queue, user } = setup(0);
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.1/ }));
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.3/ }));
    await user.click(screen.getByRole('button', { name: 'Approve 1' }));
    await waitFor(() => expect(calls.map((c) => c.path)).toEqual(['artifacts/third/review']));
  });
});

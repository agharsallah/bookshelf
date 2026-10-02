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

/** The queue lists without bodies; the preview asks for the focused one's. */
const bodyOf = (call: { path: string }) => {
  const id = call.path.split('/')[1];
  return { ...items.find((i) => i.id === id), body: { blocks: [{ type: 'paragraph', spans: [{ text: `The body of ${id}.`, cites: [] }] }] } };
};

function setup(review: Review = answer) {
  const { api, calls } = fakeApi({ 'POST artifacts/*': review, 'GET artifacts/*': bodyOf });
  const navigate = vi.fn();
  render(<ReviewQueue items={items} documents={[{ id: 'doc1', slug: 'doc', title: 'Systems' }]} headings={{}} skills={[]} api={api} navigate={navigate} />);
  const queue = screen.getByRole('navigation', { name: 'Queue' });
  const row = (anchorText: string) => within(queue).getByRole('button', { name: new RegExp(`Section note ${anchorText}`) });
  /** The verdicts sent so far, without the body fetches. */
  const verdicts = () => calls.filter((c) => c.method === 'POST');
  return { calls, verdicts, navigate, queue, row, user: userEvent.setup() };
}

describe('<ReviewQueue>', () => {
  it('approving with "a" sends the review and moves focus to the next item', async () => {
    const { verdicts, row, user } = setup();
    await user.click(row('1.1'));
    await user.keyboard('a');
    await waitFor(() => expect(verdicts()).toContainEqual({ method: 'POST', path: 'artifacts/first/review', body: { action: 'approve' } }));
    expect(document.activeElement).toBe(row('1.2'));
    expect(screen.queryByRole('button', { name: /Section note 1\.1/ })).toBeNull();
  });

  it('undo reopens a sent verdict and puts the item back as a draft', async () => {
    const { verdicts, row, user } = setup();
    await user.click(row('1.2'));
    await user.keyboard('r');
    expect(screen.queryByRole('button', { name: /Section note 1\.2/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(row('1.2')).toBeTruthy());
    expect(verdicts().map((c) => c.body)).toEqual([{ action: 'reject' }, { action: 'reopen' }]);
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

  it('a mixed selection can approve only the drafts that pass every gate', async () => {
    const { verdicts, queue, user } = setup();
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.1/ }));
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.3/ }));
    expect(screen.getByText('2 selected; 1 passes every gate.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Approve 1 passing' }));
    await waitFor(() => expect(verdicts().map((c) => c.path)).toEqual(['artifacts/third/review']));
  });

  it.each(['approve', 'reject'] as const)('%s sends every selected item at once, gates or not, and undoes together', async (action) => {
    const { verdicts, queue, row, user } = setup();
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.1/ }));
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.2/ }));
    await user.click(screen.getByRole('button', { name: `${action === 'approve' ? 'Approve' : 'Reject'} 2` }));

    await waitFor(() => expect(verdicts().map((c) => c.path).sort()).toEqual(['artifacts/first/review', 'artifacts/second/review']));
    expect(verdicts().every((c) => (c.body as { action: string }).action === action)).toBe(true);
    expect(within(queue).queryByRole('button', { name: /Section note 1\.[12]/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Bulk review' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(row('1.1')).toBeTruthy());
    expect(row('1.2')).toBeTruthy();
  });

  it('after one selection, "select all shown" selects every item the filters leave', async () => {
    const { verdicts, queue, user } = setup();
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 1\.2/ }));
    await user.click(screen.getByRole('button', { name: 'Select all 3 shown' }));

    expect(within(queue).getAllByRole('checkbox').every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('3 selected; 2 pass every gate.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Approve 2 passing' }));
    await waitFor(() => expect(verdicts().map((c) => c.path).sort()).toEqual(['artifacts/second/review', 'artifacts/third/review']));
  });

  it('filters to low confidence, so select all only takes what the filter shows', async () => {
    const { api } = fakeApi({});
    const low = artifact({ id: 'low', anchor: 'ch02/s01', gates: { grounding: 1, flags: ['low_confidence'] } });
    const lowFigure = artifact({ id: 'low-figure', anchor: 'ch02/s02', body: { confidence: 'low' } });
    render(<ReviewQueue items={[...items, low, lowFigure]} documents={[{ id: 'doc1', slug: 'doc', title: 'Systems' }]} headings={{}} skills={[]} api={api} navigate={vi.fn()} />);
    const user = userEvent.setup();
    const queue = screen.getByRole('navigation', { name: 'Queue' });

    await user.selectOptions(screen.getByRole('combobox', { name: 'Confidence' }), 'low');
    expect(within(queue).getAllByRole('checkbox')).toHaveLength(2);
    await user.click(within(queue).getByRole('checkbox', { name: /Section note 2\.1/ }));
    await user.click(screen.getByRole('button', { name: 'Select all 2 shown' }));
    expect(screen.getByText(/^2 selected;/)).toBeTruthy();
  });

  it('approve all sends every shown draft that passes its gates and leaves needs-review items', async () => {
    const { verdicts, queue, row, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Approve all 2' }));
    await waitFor(() => expect(verdicts().map((c) => c.path).sort()).toEqual(['artifacts/second/review', 'artifacts/third/review']));
    expect(verdicts().every((c) => (c.body as { action: string }).action === 'approve')).toBe(true);
    expect(row('1.1')).toBeTruthy();
    expect(within(queue).queryByRole('button', { name: /Section note 1\.2/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve all/ })).toBeNull();
  });

  it('fetches the focused body for the preview, and the next one before it is reached', async () => {
    const { calls, row, user } = setup();
    const fetched = () => calls.filter((c) => c.method === 'GET').map((c) => c.path);
    await user.click(row('1.2'));

    expect(await screen.findByText('The body of second.')).toBeTruthy();
    await waitFor(() => expect(fetched()).toContain('artifacts/third'));
    await user.keyboard('j');
    expect(await screen.findByText('The body of third.')).toBeTruthy();
    expect(fetched().filter((path) => path === 'artifacts/third')).toHaveLength(1);
  });

  it('says so in the preview when a body cannot be fetched', async () => {
    const { api } = fakeApi({ 'GET artifacts/*': () => Promise.reject(new Error('offline')) });
    render(<ReviewQueue items={items} documents={[{ id: 'doc1', slug: 'doc', title: 'Systems' }]} headings={{}} skills={[]} api={api} navigate={vi.fn()} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Section note 1\.1/ }));

    expect(await screen.findByText(/This body could not be loaded/)).toBeTruthy();
  });

  it('approve all respects the filters in place', async () => {
    const { verdicts, user } = setup();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tier' }), 'reason');
    expect(screen.queryByRole('button', { name: /Approve all/ })).toBeNull();
    expect(verdicts()).toEqual([]);
  });

  it('filters by a named select, marks the filter as set, and clears back to the whole queue', async () => {
    const { user } = setup();
    expect(screen.getByText(/need.? review/).textContent).toBe('1 needs review, 2 drafts, across 1 document.');
    const tier = screen.getByRole('combobox', { name: 'Tier' });
    await user.selectOptions(tier, 'reason');
    expect(tier.hasAttribute('data-set')).toBe(true);
    expect(screen.getByText('No queued artifact matches these filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('navigation', { name: 'Queue' })).toBeTruthy();
    expect(tier.hasAttribute('data-set')).toBe(false);
  });
});

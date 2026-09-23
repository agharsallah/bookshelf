import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ConceptSummary, MergeProposal } from '../../lib/api/types/graph';
import { fakeApi } from '../review/testing/fakeApi';
import { MergeQueue } from './MergeQueue';

const concept = (id: string, canonical: string): ConceptSummary => ({ id, canonical, aliases: [], kind: 'concept', blurb: null, merged_into: null, origin: 'skill' });

function proposal(edge: string, a: ConceptSummary, b: ConceptSummary, survivor: string | null = null): MergeProposal {
  return { edge_id: edge, a, b, similarity: 0.91, confidence: 'high', rationale: 'Same idea.', suggested_survivor: survivor, origin: 'skill:dedup', evidence: [], created_at: '2026-09-01T00:00:00Z' };
}

const loop = concept('c-loop', 'feedback loop');
const fb = concept('c-fb', 'feedback');
const stock = concept('c-stock', 'stock');
const stocks = concept('c-stocks', 'stocks');

function setup() {
  const fake = fakeApi({
    'POST concepts/c-fb/merge': () => loop,
    'POST concepts/c-loop/merge': () => fb,
    'POST concepts/c-fb/unmerge': () => fb,
    'PATCH edges/e1': () => ({}),
    'PATCH edges/e2': () => ({}),
  });
  render(<MergeQueue proposals={[proposal('e1', loop, fb, 'c-loop'), proposal('e2', stock, stocks)]} api={fake.api} />);
  return fake;
}

const card = (name: string) => screen.getByRole('article', { name });

describe('MergeQueue', () => {
  it('merges the other side into the suggested survivor, and undo unmerges it', async () => {
    const { calls } = setup();
    await userEvent.click(within(card('feedback loop or feedback')).getByRole('button', { name: 'Merge' }));
    expect(calls).toEqual([{ method: 'POST', path: 'concepts/c-fb/merge', body: { into: 'c-loop' } }]);
    expect(screen.queryByRole('article', { name: 'feedback loop or feedback' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls.at(-1)).toEqual({ method: 'POST', path: 'concepts/c-fb/unmerge', body: undefined });
    expect(await screen.findByRole('article', { name: 'feedback loop or feedback' })).toBeTruthy();
  });

  it('merges into whichever side you choose to keep', async () => {
    const { calls } = setup();
    const first = card('feedback loop or feedback');
    await userEvent.click(within(first).getByRole('radio', { name: 'Keep “feedback”' }));
    await userEvent.click(within(first).getByRole('button', { name: 'Merge' }));
    expect(calls).toEqual([{ method: 'POST', path: 'concepts/c-loop/merge', body: { into: 'c-fb' } }]);
  });

  it('rejects by marking the proposed edge rejected, and undo proposes it again', async () => {
    const { calls } = setup();
    await userEvent.click(within(card('stock or stocks')).getByRole('button', { name: 'Reject' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(calls).toEqual([
      { method: 'PATCH', path: 'edges/e2', body: { status: 'rejected' } },
      { method: 'PATCH', path: 'edges/e2', body: { status: 'proposed' } },
    ]);
  });

  it('skips to the back of the queue without calling the API', async () => {
    const { calls } = setup();
    await userEvent.click(within(card('feedback loop or feedback')).getByRole('button', { name: 'Skip' }));
    expect(screen.getAllByRole('article').map((a) => a.getAttribute('aria-label'))).toEqual(['stock or stocks', 'feedback loop or feedback']);
    expect(calls).toEqual([]);
  });

  it('takes M, R and S from the keyboard on the focused proposal', async () => {
    const { calls } = setup();
    card('stock or stocks').focus();
    await userEvent.keyboard('r');
    expect(calls).toEqual([{ method: 'PATCH', path: 'edges/e2', body: { status: 'rejected' } }]);
  });
});

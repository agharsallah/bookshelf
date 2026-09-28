import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReadingCandidatePublic } from '../../../lib/api/types/papers';
import { fakeApi } from '../../review/testing/fakeApi';
import { NextQueue } from './NextQueue';

const DOC = 'd0000000-0000-4000-8000-000000000001';

function candidate(over: Partial<ReadingCandidatePublic> = {}): ReadingCandidatePublic {
  return {
    id: 'c1',
    openalex_id: 'W1',
    doi: null,
    arxiv_id: null,
    title: 'Outrageously Large Neural Networks',
    authors: ['Noam Shazeer'],
    year: 2017,
    venue: 'ICLR',
    abstract: null,
    pdf_url: null,
    cited_by_count: 3000,
    sources: [{ kind: 'reference', document_id: DOC }],
    score: 2.1,
    score_parts: { source: 1, shelf: 1, rating: 0, recency: 0.1 },
    reason: 'Your 5-star paper builds its router on it.',
    reason_cites: [`${DOC}#ch03/p002`],
    status: 'suggested',
    document_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const shelf = { [DOC]: { slug: 'moe', title: 'Mixture of Experts' } };

describe('<NextQueue>', () => {
  it('shows the reason with a cite into the shelf paper, how it was found and why it scores', () => {
    const { api } = fakeApi({});
    render(<NextQueue candidates={[candidate()]} shelf={shelf} api={api} />);
    expect(screen.getByRole('link', { name: '3 ¶2' }).getAttribute('href')).toBe('/documents/moe/read/ch03/p002');
    expect(screen.getByText(/via Mixture of Experts/)).toBeTruthy();
    expect(screen.getByText('Why it ranks here')).toBeTruthy();
    expect(screen.getByText('Cited on your shelf')).toBeTruthy();
    expect(screen.getByText('No open PDF known')).toBeTruthy();
  });

  it('dismisses a paper into one line and undoes it back to where it was', async () => {
    const { api, calls } = fakeApi({
      'PATCH papers/candidates/c1': (call) => candidate({ status: (call.body as { status: ReadingCandidatePublic['status'] }).status }),
    });
    render(<NextQueue candidates={[candidate({ status: 'queued' })]} shelf={shelf} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByText(/Dismissed/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: 'Unqueue' })).toBeTruthy();
    expect(calls.map((c) => c.body)).toEqual([{ status: 'dismissed' }, { status: 'queued' }]);
  });
});

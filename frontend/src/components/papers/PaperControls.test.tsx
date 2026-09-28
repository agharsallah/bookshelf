import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { fakeApi } from '../review/testing/fakeApi';
import { rating } from './fixtures';
import { PaperRating } from './PaperRating';
import { PassTracker } from './PassTracker';

describe('<PaperRating>', () => {
  it('saves stars, verdict and note as a new rating and lists the old one below', async () => {
    const saved = rating({ id: 'r2', stars: 5, verdict: 'must_read', note: 'Changed my mind.', created_at: '2026-09-28T10:00:00Z' });
    const { api, calls } = fakeApi({ 'POST papers/bert/ratings': () => saved });
    render(<PaperRating paperRef="bert" history={[rating()]} api={api} />);

    expect((screen.getByRole('button', { name: 'Save new rating' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('radio', { name: '5 of 5 stars' }));
    await userEvent.click(screen.getByRole('button', { name: 'Must read' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'Changed my mind.');
    await userEvent.click(screen.getByRole('button', { name: 'Save new rating' }));

    expect(calls).toEqual([{ method: 'POST', path: 'papers/bert/ratings', body: { stars: 5, verdict: 'must_read', note: 'Changed my mind.' } }]);
    expect(await screen.findByText('Earlier ratings (1)')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Note' }) as HTMLTextAreaElement).value).toBe('');
  });
});

describe('<PassTracker>', () => {
  it('marks a pass done with the server’s time, and undoes it', async () => {
    const { api, calls } = fakeApi({
      'PUT papers/bert/passes/1': () => ({ document_id: 'd1', pass: 1, completed_at: '2026-09-03T10:00:00Z', note: null }),
      'DELETE papers/bert/passes/1': () => undefined,
    });
    render(<PassTracker paperRef="bert" documentId="d1" passes={[]} api={api} />);
    const skim = screen.getByRole('button', { name: /Pass 1: Skim/ });

    await userEvent.click(skim);
    expect(skim.getAttribute('aria-pressed')).toBe('true');
    expect(await screen.findByText(/^3 Sept?$/)).toBeTruthy();
    await userEvent.click(skim);
    expect(skim.getAttribute('aria-pressed')).toBe('false');
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PUT papers/bert/passes/1', 'DELETE papers/bert/passes/1']);
  });

  it('rolls the step back and says why when the server refuses', async () => {
    const down = new ApiError({ status: 0, code: 'network_error', message: 'The API could not be reached.' });
    const { api } = fakeApi({ 'PUT papers/bert/passes/2': () => Promise.reject(down) });
    render(<PassTracker paperRef="bert" documentId="d1" passes={[]} api={api} />);
    const read = screen.getByRole('button', { name: /Pass 2: Read/ });
    await userEvent.click(read);
    expect(await screen.findByText(/Not saved: The API could not be reached/)).toBeTruthy();
    expect(read.getAttribute('aria-pressed')).toBe('false');
  });
});

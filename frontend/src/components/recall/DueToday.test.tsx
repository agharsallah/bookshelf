import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DueCard } from '../../lib/api/types/recalls';
import type { RecallApi } from './api';
import { DueToday } from './DueToday';

vi.mock('../../lib/api/client', () => ({ browserApi: {} }));

const card = (id: string, prompt: string): DueCard => ({
  id,
  document: { id: 'd1', slug: 'flow', title: 'Flow' },
  anchor: 'ch01/p001',
  source: 'recall',
  prompt,
  due: '2026-09-28T00:00:00Z',
});

/** Spies for assertions, typed as a `RecallApi` so the generic `post` accepts the canned replies. */
function fakeApi() {
  const api = {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn((path: string) =>
      Promise.resolve(
        path.endsWith('/reveal')
          ? { id: 'c1', anchor: 'ch01/p001', answer: [{ text: 'Slack absorbs surprises.', cites: ['ch01/p001'] }] }
          : { id: 'c1', due: '2026-10-01T00:00:00Z', last_rating: 3 },
      ),
    ),
  };
  return api as typeof api & RecallApi;
}

afterEach(cleanup);

describe('<DueToday>', () => {
  it('says nothing is due, without a count, when no card is due', () => {
    render(<DueToday initial={{ items: [], total: 0 }} api={fakeApi()} />);
    expect(screen.getByRole('status').textContent).toMatch(/^Nothing is due today/);
    expect(screen.queryByText(/to review|reviewed/)).toBeNull();
  });

  it('says the cards could not be loaded when they failed to load', () => {
    render(<DueToday initial={null} api={fakeApi()} />);
    expect(screen.getByRole('status').textContent).toMatch(/could not be loaded/);
  });

  it('shows the prompt alone, reveals the cited answer only after an attempt, and rates to the next card', async () => {
    const api = fakeApi();
    render(<DueToday initial={{ items: [card('c1', 'What does slack do?'), card('c2', 'Why do queues grow?')], total: 2 }} api={api} />);

    expect(screen.getByText('What does slack do?')).toBeTruthy();
    expect(screen.queryByText('Slack absorbs surprises.')).toBeNull();
    const reveal = screen.getByRole('button', { name: /Reveal the answer/ }) as HTMLButtonElement;
    expect(reveal.disabled).toBe(true);

    await userEvent.type(screen.getByRole('textbox'), 'It absorbs surprises');
    await userEvent.click(reveal);
    expect(api.post).toHaveBeenCalledWith('reviews/c1/reveal', { answer: 'It absorbs surprises' });
    expect(await screen.findByText('Slack absorbs surprises.')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).readOnly).toBe(true);

    await userEvent.keyboard('4');
    expect(api.post).toHaveBeenLastCalledWith('reviews/c1/rating', { rating: 4, answer: 'It absorbs surprises' });
    expect(await screen.findByText('Why do queues grow?')).toBeTruthy();
    expect(screen.getByText('1 to review')).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  });

  it('says so when the last card is done', async () => {
    const api = fakeApi();
    render(<DueToday initial={{ items: [card('c1', 'What does slack do?')], total: 1 }} api={api} />);
    await userEvent.type(screen.getByRole('textbox'), 'reserve');
    await userEvent.click(screen.getByRole('button', { name: /Reveal the answer/ }));
    await userEvent.click(await screen.findByRole('button', { name: /Good/ }));
    expect((await screen.findByRole('status')).textContent).toMatch(/^All done: 1 card, and you knew every one\./);
    expect(api.get).not.toHaveBeenCalled();
  });
});

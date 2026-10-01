import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteDetail } from '../../lib/api/types/notes';
import { Margins } from './Margins';
import type { MarginNote } from './today';

vi.mock('../../lib/api/client', () => ({ browserApi: {} }));

const books = { d1: { slug: 'deep-work', title: 'Deep Work: Rules for Focused Success' } };
const shown: MarginNote = {
  id: 'n1',
  passage: 'Clarity about what matters provides clarity about what does not.',
  raw: 'Say no more often.',
  color: 'amber',
  anchor: 'ch02/p003',
  created_at: '2026-09-24T10:00:00Z',
  book: books.d1,
};
const detail = (id: string, passage: string) =>
  ({ id, document_id: 'd1', anchor: 'ch03/p001', raw: null, color: null, created_at: '2026-09-20T10:00:00Z', detached: false, passage }) as NoteDetail;
const now = '2026-10-01T12:00:00Z';

afterEach(cleanup);

describe('<Margins>', () => {
  it('shows the passage with your words, when and where it was marked, and a link to its place', () => {
    render(<Margins initial={shown} total={5} books={books} now={now} api={{ get: vi.fn() }} />);
    expect(screen.getByText(shown.passage).tagName).toBe('MARK');
    expect(screen.getByText('Say no more often.')).toBeTruthy();
    expect(screen.getByText(/Marked 7 days ago in/).textContent).toBe('Marked 7 days ago in Deep Work, at 2 ¶3');
    expect(screen.getByRole('link', { name: 'Open in the book' }).getAttribute('href')).toBe('/documents/deep-work/read/ch02/p003');
  });

  it('draws another passage, never the one already shown', async () => {
    const get = vi.fn().mockResolvedValue({ items: [detail('n1', shown.passage), detail('n2', 'Depth is a skill.')], total: 5 });
    render(<Margins initial={shown} total={5} books={books} now={now} api={{ get } as never} random={() => 0} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show another' }));
    expect(get).toHaveBeenCalledWith('notes', { query: { limit: 10, offset: 0 } });
    expect(await screen.findByText('Depth is a skill.')).toBeTruthy();
    expect(screen.queryByText(shown.passage)).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in the book' }).getAttribute('href')).toBe('/documents/deep-work/read/ch03/p001');
  });

  it('offers no other passage when there is only one, and invites marking when there is none', () => {
    render(<Margins initial={shown} total={1} books={books} now={now} api={{ get: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: 'Show another' })).toBeNull();
    cleanup();
    render(<Margins initial={null} total={0} books={books} now={now} api={{ get: vi.fn() }} />);
    expect(screen.getByText(/Passages you highlight while reading come back here/)).toBeTruthy();
  });
});

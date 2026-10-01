import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { ArchivedList, type ArchivedBook } from './ArchivedList';

const books: ArchivedBook[] = [
  { id: 'a', slug: 'meadows', title: 'Thinking in Systems', authors: ['Donella Meadows'], source_path: 'library/m.pdf', archived_at: '2026-10-01T09:00:00Z' },
  { id: 'b', slug: 'senge', title: 'The Fifth Discipline', authors: [], source_path: null, archived_at: '2026-09-30T09:00:00Z' },
];

const row = (title: string) => screen.getByRole('link', { name: title }).closest('li') as HTMLElement;

describe('<ArchivedList>', () => {
  it('lists each book with who wrote it and when it was archived', () => {
    render(<ArchivedList books={books} api={fakeApi().api} />);

    expect(row('Thinking in Systems').textContent).toMatch(/Donella Meadows · archived 1 October 2026/);
    expect(screen.getByRole('link', { name: 'The Fifth Discipline' }).getAttribute('href')).toBe('/documents/senge');
  });

  it('restores a book and takes it off the list', async () => {
    const { api, calls } = fakeApi({ 'POST documents/meadows/restore': () => ({ document: {}, requeued: [] }) });
    render(<ArchivedList books={books} api={api} />);

    await userEvent.click(within(row('Thinking in Systems')).getByRole('button', { name: 'Restore' }));

    expect(calls).toEqual([{ method: 'POST', path: 'documents/meadows/restore' }]);
    expect(screen.queryByRole('link', { name: 'Thinking in Systems' })).toBeNull();
    expect(screen.getByRole('link', { name: 'The Fifth Discipline' })).toBeTruthy();
  });

  it('deletes a book for good from the dialog', async () => {
    const { api, calls } = fakeApi({ 'DELETE documents/senge': () => undefined });
    render(<ArchivedList books={books} api={api} />);

    await userEvent.click(within(row('The Fifth Discipline')).getByRole('button', { name: 'Delete…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “The Fifth Discipline” for good?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));

    expect(calls).toEqual([{ method: 'DELETE', path: 'documents/senge' }]);
    expect(screen.queryByRole('link', { name: 'The Fifth Discipline' })).toBeNull();
  });

  it('says when nothing is archived', () => {
    render(<ArchivedList books={[]} api={fakeApi().api} />);

    expect(screen.getByText(/Nothing is archived/)).toBeTruthy();
  });
});

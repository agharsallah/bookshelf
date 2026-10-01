import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { fakeApi } from '../review/testing/fakeApi';
import { RemoveBook } from './RemoveBook';

const book = { documentRef: 'meadows', title: 'Thinking in Systems', sourcePath: 'library/meadows.pdf' };

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Archive or delete…' }));
  return screen.getByRole('dialog', { name: 'Remove “Thinking in Systems” from the shelf' });
}

describe('<RemoveBook> on the shelf', () => {
  it('archives the book and reloads the page', async () => {
    const { api, calls } = fakeApi({ 'POST documents/meadows/archive': () => ({}) });
    const go = vi.fn();
    render(<RemoveBook {...book} archivedAt={null} api={api} go={go} />);

    await userEvent.click(within(await openDialog()).getByRole('button', { name: 'Archive' }));

    expect(calls).toEqual([{ method: 'POST', path: 'documents/meadows/archive' }]);
    expect(go).toHaveBeenCalledWith(null);
  });

  it('deletes for good, keeping the original file unless asked, then goes to the library', async () => {
    const { api, calls } = fakeApi({ 'DELETE documents/meadows': () => undefined });
    const go = vi.fn();
    render(<RemoveBook {...book} archivedAt={null} api={api} go={go} />);

    await userEvent.click(within(await openDialog()).getByRole('button', { name: 'Delete for good' }));

    expect(calls).toEqual([{ method: 'DELETE', path: 'documents/meadows' }]);
    expect(go).toHaveBeenCalledWith('/library');
  });

  it('deletes the original file too when the box is ticked', async () => {
    const { api, calls } = fakeApi({ 'DELETE documents/meadows': () => undefined });
    render(<RemoveBook {...book} archivedAt={null} api={api} go={vi.fn()} />);
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Also delete the original file/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete it and its file' }));

    expect(calls).toEqual([{ method: 'DELETE', path: 'documents/meadows', query: { file: true } }]);
  });

  it('offers no file to delete when the book has none', async () => {
    render(<RemoveBook {...book} sourcePath={null} archivedAt={null} api={fakeApi().api} go={vi.fn()} />);

    expect(within(await openDialog()).queryByRole('checkbox')).toBeNull();
  });

  it('stays open and says why when the delete fails', async () => {
    const down = new ApiError({ status: 0, code: 'network_error', message: 'The API could not be reached.' });
    const { api } = fakeApi({ 'DELETE documents/meadows': () => Promise.reject(down) });
    const go = vi.fn();
    render(<RemoveBook {...book} archivedAt={null} api={api} go={go} />);
    const dialog = await openDialog();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete for good' }));

    expect((await within(dialog).findByRole('alert')).textContent).toMatch(/The book was not deleted/);
    expect(go).not.toHaveBeenCalled();
  });
});

describe('<RemoveBook> archived', () => {
  const archivedAt = '2026-10-01T09:00:00Z';

  it('says when it was archived and restores it', async () => {
    const { api, calls } = fakeApi({ 'POST documents/meadows/restore': () => ({ document: {}, requeued: [] }) });
    const go = vi.fn();
    render(<RemoveBook {...book} archivedAt={archivedAt} api={api} go={go} />);

    expect(screen.getByRole('region', { name: 'Archived' }).textContent).toMatch(/Archived on 1 October 2026/);
    await userEvent.click(screen.getByRole('button', { name: 'Restore to the shelf' }));

    expect(calls).toEqual([{ method: 'POST', path: 'documents/meadows/restore' }]);
    expect(go).toHaveBeenCalledWith(null);
  });

  it('offers only the delete, not a second archive', async () => {
    render(<RemoveBook {...book} archivedAt={archivedAt} api={fakeApi().api} go={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Delete for good…' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete “Thinking in Systems” for good?' });

    expect(within(dialog).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Delete for good' })).toBeTruthy();
  });
});

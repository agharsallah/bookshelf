import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SnapshotStatus } from '../../lib/api/types/snapshots';
import { fakeApi } from '../review/testing/fakeApi';
import { SnapshotSection } from './SnapshotSection';
import { idleSnapshot, snapshotStatus } from './testing';

const latest = { name: 'bookshelf-20261016-100000.tar.gz', size_bytes: 2_097_152, created_at: '2026-10-16T10:00:00Z', documents: 3, files: 12 };
const snapshotFile = (name = 'bookshelf-20261016-100000.tar.gz') => new File([new Uint8Array([31, 139])], name, { type: 'application/gzip' });

describe('<SnapshotSection>', () => {
  it('makes a snapshot and follows it until it can be downloaded', async () => {
    const running = (done: number): SnapshotStatus =>
      snapshotStatus({ progress: { ...idleSnapshot, state: 'running', action: 'export', step: 'Packing library/a.pdf', done, total: 10 } });
    const answers = [snapshotStatus(), running(4), snapshotStatus({ latest, progress: { ...idleSnapshot, state: 'done', action: 'export' } })];
    const { api, calls } = fakeApi({
      'GET database/snapshot': () => answers.shift() ?? snapshotStatus({ latest }),
      'POST database/snapshot': () => running(0).progress,
    });
    render(<SnapshotSection api={api} pollMs={1} />);

    expect(await screen.findByText(/No snapshot made here yet\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Make a snapshot' }));

    expect(await screen.findByText('Snapshot ready to download.')).toBeTruthy();
    expect(screen.getByText(/2\.0 MB · 3 documents, 12 files/)).toBeTruthy();
    const download = screen.getByRole('button', { name: /Download/ });
    expect(download.closest('form')?.getAttribute('action')).toBe('/api/database/snapshot/download');
    expect(download.closest('form')?.getAttribute('method')).toBe('post');
    expect(calls.filter((c) => c.method === 'POST')).toEqual([{ method: 'POST', path: 'database/snapshot', body: undefined }]);
  });

  it('confirms, then uploads the picked file with a backup and reports the restore', async () => {
    const answers = [snapshotStatus(), snapshotStatus({ progress: { ...idleSnapshot, state: 'done', action: 'restore', rows: 812, kept_path: '/x/before-restore' } })];
    const { api, calls } = fakeApi({
      'GET database/snapshot': () => answers.shift() ?? snapshotStatus(),
      'POST database/snapshot/restore': () => ({ ...idleSnapshot, state: 'running', action: 'restore', step: 'Starting' }),
    });
    render(<SnapshotSection api={api} pollMs={1} />);
    const file = snapshotFile();

    await userEvent.upload(await screen.findByLabelText('Snapshot file'), file);
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).getByRole('heading', { hidden: true }).textContent).toBe('Replace everything on This computer with this snapshot?');
    expect((within(dialog).getByRole('checkbox', { hidden: true }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore', hidden: true }));

    expect(await screen.findByText(/Restored 812 rows into This computer\..*Replaced folders: \/x\/before-restore\./)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', path: 'database/snapshot/restore', body: file, query: { backup: true } });
  });

  it('refuses a file that is not a snapshot without uploading it', async () => {
    const { api, calls } = fakeApi({ 'GET database/snapshot': () => snapshotStatus() });
    render(<SnapshotSection api={api} />);

    await userEvent.upload(await screen.findByLabelText('Snapshot file'), snapshotFile('holiday.zip'), { applyAccept: false });

    expect((await screen.findByRole('alert')).textContent).toMatch(/That file cannot be restored\..*\.tar\.gz file made by Bookshelf/);
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('holds both actions while a snapshot is being restored', async () => {
    const restoring = snapshotStatus({ latest, progress: { ...idleSnapshot, state: 'running', action: 'restore', step: 'Restoring nodes', done: 3, total: 30 } });
    const { api } = fakeApi({ 'GET database/snapshot': () => restoring });
    render(<SnapshotSection api={api} pollMs={60_000} />);

    expect(await screen.findByText('Restoring nodes (3 of 30)')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Make a new snapshot' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Restore a snapshot/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Download/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

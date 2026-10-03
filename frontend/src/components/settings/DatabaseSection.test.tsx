import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type { DatabaseStatus } from '../../lib/api/types/database';
import { fakeApi } from '../review/testing/fakeApi';
import { DatabaseSection } from './DatabaseSection';
import { counts, dbStatus, idleSync } from './testing';

const radio = (name: RegExp) => screen.getByRole('radio', { name });

describe('<DatabaseSection>', () => {
  it('shows both databases and which one is in use', async () => {
    const { api } = fakeApi({ 'GET database': () => dbStatus() });
    render(<DatabaseSection api={api} />);

    expect((await screen.findByRole('radio', { name: /Supabase/ })).getAttribute('aria-checked')).toBe('true');
    expect(radio(/This computer/).getAttribute('aria-checked')).toBe('false');
    expect(radio(/Supabase/).textContent).toMatch(/In use/);
    expect(radio(/This computer/).textContent).toMatch(/2 documents · 10 notes/);
  });

  it('switches when the other card is picked', async () => {
    const { api, calls } = fakeApi({
      'GET database': () => dbStatus(),
      'PUT database/active': () => dbStatus({ active: 'local' }),
    });
    render(<DatabaseSection api={api} />);

    await userEvent.click(await screen.findByRole('radio', { name: /This computer/ }));

    expect(await screen.findByText('Now reading and writing This computer.')).toBeTruthy();
    expect(radio(/This computer/).getAttribute('aria-checked')).toBe('true');
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([{ method: 'PUT', path: 'database/active', body: { target: 'local' } }]);
  });

  it('keeps the database in use and says why when a switch is refused', async () => {
    const refused = new ApiError({ status: 409, code: 'conflict', message: 'The two databases have different schemas.' });
    const { api } = fakeApi({ 'GET database': () => dbStatus(), 'PUT database/active': () => Promise.reject(refused) });
    render(<DatabaseSection api={api} />);

    await userEvent.click(await screen.findByRole('radio', { name: /This computer/ }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/Still using Supabase\..*different schemas/);
    expect(radio(/Supabase/).getAttribute('aria-checked')).toBe('true');
  });

  it('confirms, then uploads with a backup and follows the sync to the end', async () => {
    const running = (tables_done: number): DatabaseStatus =>
      dbStatus({ sync: { ...idleSync, state: 'running', source: 'local', dest: 'remote', step: 'Copying nodes', tables_done, tables_total: 4 } });
    const answers = [dbStatus(), running(2), dbStatus({ sync: { ...idleSync, state: 'done', source: 'local', dest: 'remote', rows: 120 } })];
    const { api, calls } = fakeApi({
      'GET database': () => answers.shift() ?? dbStatus(),
      'POST database/sync': () => running(0).sync,
    });
    render(<DatabaseSection api={api} pollMs={1} />);

    await userEvent.click(await screen.findByRole('button', { name: /Upload to Supabase/ }));
    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).getByRole('heading', { hidden: true }).textContent).toBe('Replace Supabase’s library with This computer’s?');
    expect((within(dialog).getByRole('checkbox', { hidden: true }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload to Supabase', hidden: true }));

    expect(await screen.findByText(/Synced This computer → Supabase: 120 rows copied\./)).toBeTruthy();
    expect(calls.find((c) => c.method === 'POST')).toEqual({ method: 'POST', path: 'database/sync', body: { source: 'local', backup: true } });
    expect(calls.filter((c) => c.method === 'GET').length).toBe(3); // first look, one poll mid-copy, the end
  });

  it('warns in the confirmation when the side being replaced is newer', async () => {
    const remoteNewer = dbStatus({}, {}, { counts: counts({ last_change: '2026-10-02T00:00:00Z' }) });
    const { api } = fakeApi({ 'GET database': () => remoteNewer });
    render(<DatabaseSection api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: /Upload to Supabase/ }));

    const dialog = screen.getByRole('dialog', { hidden: true });
    expect(within(dialog).getByRole('alert', { hidden: true }).textContent).toMatch(/Supabase changed more recently/);
  });

  it('turns the sync off, with the reason, while jobs run', async () => {
    const { api } = fakeApi({ 'GET database': () => dbStatus({}, { counts: counts({ running_jobs: 1 }) }) });
    render(<DatabaseSection api={api} />);

    const upload = await screen.findByRole('button', { name: /Upload to Supabase/ });
    expect((upload as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('1 job is running on This computer. Sync once they finish.')).toBeTruthy();
  });

  it('explains how to set up a second database when there is one', async () => {
    const one = dbStatus({ available: false });
    const { api } = fakeApi({ 'GET database': () => ({ ...one, targets: one.targets.slice(1) }) });
    render(<DatabaseSection api={api} />);

    expect((await screen.findByText(/Only one database is configured/)).textContent).toMatch(/BOOKSHELF_LOCAL_DATABASE_URL/);
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

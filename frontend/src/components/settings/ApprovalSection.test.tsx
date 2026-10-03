import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type { AutoApprove, SettingsPublic } from '../../lib/api/types/settings';
import { fakeApi } from '../review/testing/fakeApi';
import { ApprovalSection } from './ApprovalSection';
import { settingsOf } from './testing';

const settings = (auto_approve: AutoApprove): SettingsPublic => settingsOf({ auto_approve });
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

describe('<ApprovalSection>', () => {
  it('shows the saved mode', async () => {
    const { api } = fakeApi({ 'GET settings': () => settings('passing') });
    render(<ApprovalSection api={api} />);

    expect(await screen.findByText(/every quality check passed/)).toBeTruthy();
    expect(pressed('Clean drafts')).toBe('true');
    expect(pressed('Review everything')).toBe('false');
  });

  it('saves the mode picked', async () => {
    const { api, calls } = fakeApi({ 'GET settings': () => settings('off'), 'PATCH settings': () => settings('all') });
    render(<ApprovalSection api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Everything' }));

    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    expect(pressed('Everything')).toBe('true');
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([{ method: 'PATCH', path: 'settings', body: { auto_approve: 'all' } }]);
  });

  it('keeps the old mode and says why when saving fails', async () => {
    const refused = new ApiError({ status: 401, code: 'unauthorized', message: 'Missing API key.' });
    const { api } = fakeApi({ 'GET settings': () => settings('off'), 'PATCH settings': () => Promise.reject(refused) });
    render(<ApprovalSection api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Everything' }));

    expect(await screen.findByText(/Not saved: Missing API key\./)).toBeTruthy();
    expect(pressed('Review everything')).toBe('true');
  });
});

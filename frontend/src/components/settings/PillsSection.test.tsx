import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type { PillsSettings, SettingsPublic } from '../../lib/api/types/settings';
import { fakeApi } from '../review/testing/fakeApi';
import { capOptions, PillsSection } from './PillsSection';
import { settingsOf } from './testing';

const settings = (pills: Partial<PillsSettings> = {}): SettingsPublic =>
  settingsOf({ pills: { auto_generate: true, max_chapters_per_day: 4, ...pills } });
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const toggle = () => screen.findByRole('checkbox', { name: /Compose pills for the next chapters/ });

describe('<PillsSection>', () => {
  it('shows the saved settings', async () => {
    const { api } = fakeApi({ 'GET settings': () => settings({ auto_generate: false, max_chapters_per_day: 8 }) });
    render(<PillsSection api={api} />);

    expect(((await toggle()) as HTMLInputElement).checked).toBe(false);
    expect(pressed('8')).toBe('true');
    expect(pressed('4')).toBe('false');
  });

  it('saves only what changed', async () => {
    const { api, calls } = fakeApi({
      'GET settings': () => settings(),
      'PATCH settings': () => settings({ max_chapters_per_day: 2 }),
    });
    render(<PillsSection api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: '2' }));

    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(pressed('2')).toBe('true');
    expect(calls.filter((c) => c.method === 'PATCH')).toEqual([{ method: 'PATCH', path: 'settings', body: { pills: { max_chapters_per_day: 2 } } }]);
  });

  it('rolls back and says why when saving fails', async () => {
    const refused = new ApiError({ status: 401, code: 'unauthorized', message: 'Missing API key.' });
    const { api } = fakeApi({ 'GET settings': () => settings(), 'PATCH settings': () => Promise.reject(refused) });
    render(<PillsSection api={api} />);

    await userEvent.click(await toggle());

    expect(await screen.findByText(/Not saved: Missing API key\./)).toBeTruthy();
    expect(((await toggle()) as HTMLInputElement).checked).toBe(true);
  });

  it('offers a cap the API set even when it is not a usual choice', () => {
    expect(capOptions(5).map((o) => o.value)).toEqual(['1', '2', '4', '5', '8', '16']);
    expect(capOptions(4).map((o) => o.value)).toEqual(['1', '2', '4', '8', '16']);
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import type { SettingsPublic } from '../../lib/api/types/settings';
import { fakeApi } from '../review/testing/fakeApi';
import { BuildsSection } from './BuildsSection';
import { buildDefaults, settingsOf } from './testing';

const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const echo = (call: { body?: unknown }) => settingsOf({ builds: (call.body as Pick<SettingsPublic, 'builds'>).builds });

describe('<BuildsSection>', () => {
  it('saves the visibility picked, with the other defaults as they were', async () => {
    const { api, calls } = fakeApi({ 'GET settings': () => settingsOf(), 'PATCH settings': echo });
    render(<BuildsSection api={api} />);

    await userEvent.click(await screen.findByRole('button', { name: 'Local only' }));

    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    expect(pressed('Local only')).toBe('true');
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ builds: buildDefaults({ visibility: 'local' }) });
  });

  it('saves the owner and the limits when you leave their fields, blank budget meaning no cap', async () => {
    const { api, calls } = fakeApi({ 'GET settings': () => settingsOf({ builds: buildDefaults({ max_budget_usd: 5 }) }), 'PATCH settings': echo });
    render(<BuildsSection api={api} />);

    await userEvent.type(await screen.findByLabelText('GitHub owner'), ' my-lab ');
    await userEvent.tab();
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1));

    await userEvent.clear(screen.getByLabelText(/Budget/));
    await userEvent.tab();
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));

    expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([
      { builds: buildDefaults({ owner: 'my-lab', max_budget_usd: 5 }) },
      { builds: buildDefaults({ owner: 'my-lab', max_budget_usd: null }) },
    ]);
  });

  it('refuses a limit out of range without sending it', async () => {
    const { api, calls } = fakeApi({ 'GET settings': () => settingsOf() });
    render(<BuildsSection api={api} />);

    const minutes = await screen.findByLabelText(/Minutes/);
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '2');
    await userEvent.tab();

    expect(await screen.findByText(/Not saved: Between 5 and 720 minutes/)).toBeTruthy();
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
  });

  it('puts the switch back and says why when saving fails', async () => {
    const refused = new ApiError({ status: 401, code: 'unauthorized', message: 'Missing API key.' });
    const { api } = fakeApi({ 'GET settings': () => settingsOf(), 'PATCH settings': () => Promise.reject(refused) });
    render(<BuildsSection api={api} />);

    const credit = await screen.findByRole('checkbox', { name: /Credit Claude/ });
    await userEvent.click(credit);

    expect(await screen.findByText(/Not saved: Missing API key\./)).toBeTruthy();
    expect(credit).toHaveProperty('checked', false);
  });

  it('saves an advanced default with the others as they were', async () => {
    const { api, calls } = fakeApi({ 'GET settings': () => settingsOf(), 'PATCH settings': echo });
    render(<BuildsSection api={api} />);

    await userEvent.click(within(await screen.findByRole('group', { name: 'Delivery' })).getByRole('button', { name: 'Pull request' }));

    expect(await screen.findByText(/^Saved\./)).toBeTruthy();
    const advanced = buildDefaults().advanced;
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ builds: buildDefaults({ advanced: { ...advanced, delivery: 'pull_request' } }) });
  });
});

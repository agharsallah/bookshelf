import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { RepoCombobox } from './RepoCombobox';
import { repoChoice } from './testing';

const repos = [repoChoice({ full_name: 'me/a' }), repoChoice({ full_name: 'org/locked', can_push: false }), repoChoice({ full_name: 'me/c' })];

describe('<RepoCombobox>', () => {
  it('moves with the arrow keys past read-only repositories, and Enter picks', async () => {
    const { api, calls } = fakeApi({ 'GET builds/repos': () => repos });
    const onPick = vi.fn();
    render(<RepoCombobox api={api} value="" onPick={onPick} delayMs={0} />);

    const input = screen.getByRole('combobox', { name: 'Repository' });
    await userEvent.type(input, 'm');
    await screen.findAllByRole('option');
    expect(calls.at(-1)?.query).toEqual({ q: 'm' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /me\/a/ }).id);

    await userEvent.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /me\/c/ }).id);
    await userEvent.keyboard('{Enter}');

    expect(onPick).toHaveBeenCalledWith(repos[2]);
    expect(input).toHaveProperty('value', 'me/c');
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'));
  });

  it('says so when nothing matches, and closes on Escape', async () => {
    const { api } = fakeApi({ 'GET builds/repos': () => [] });
    render(<RepoCombobox api={api} value="" onPick={vi.fn()} delayMs={0} />);
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(await screen.findByText('No repository of yours matches.')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByText(/Repositories you or your organizations have/)).toBeTruthy();
  });
});

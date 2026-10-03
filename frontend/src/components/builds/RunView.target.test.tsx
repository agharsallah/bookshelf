import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BuildPublic } from '../../lib/api/types/builds';
import { fakeApi } from '../review/testing/fakeApi';
import { RunView } from './RunView';
import { build, options, target } from './testing';

const commits = [{ sha: 'aaaaaaa1111', subject: 'chore(attention): seed papers/attention from attention', at: '2026-10-03T10:00:00Z' }];
const local = target({ kind: 'local', repo: null, path: '/Users/me/code/foo' });

const into = (t = target(), over: Partial<BuildPublic> = {}) =>
  build({ state: 'done', stop_reason: 'goal_reached', run_job_id: 'j2', commits, options: options({ repo_name: null, target: t }), ...over });

function show(b: BuildPublic) {
  const { api } = fakeApi();
  render(<RunView build={b} api={api} onChange={vi.fn()} onDeleted={vi.fn()} />);
}

describe('<RunView> into an existing repository', () => {
  it('names the GitHub repo and folder, and links commits on that repo', () => {
    show(into(target(), { repo_url: 'https://github.com/me/lab' }));

    expect(screen.getByRole('link', { name: 'me/lab · papers/attention ↗' }).getAttribute('href')).toBe('https://github.com/me/lab');
    expect(screen.getByRole('link', { name: 'aaaaaaa' }).getAttribute('href')).toBe('https://github.com/me/lab/commit/aaaaaaa1111');
    expect(screen.queryByRole('region', { name: 'Where the work is' })).toBeNull();
  });

  it('tells where a finished local build left its work, with the command to switch to it', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    show(into(local));

    expect(screen.getByText('~/code/foo · papers/attention')).toBeTruthy();
    expect(screen.getByText('aaaaaaa', { selector: 'code' })).toBeTruthy();
    expect(screen.queryAllByRole('link')).toEqual([]);
    const note = screen.getByRole('region', { name: 'Where the work is' });
    expect(note.textContent).toContain('The work is on branch build/attention in ~/code/foo.');
    expect(within(note).getByText('git switch build/attention')).toBeTruthy();
    await userEvent.click(within(note).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('git switch build/attention');
  });

  it('says nothing about the branch while the local build still runs', () => {
    show(into(local, { state: 'building', stop_reason: null }));
    expect(screen.queryByRole('region', { name: 'Where the work is' })).toBeNull();
  });
});

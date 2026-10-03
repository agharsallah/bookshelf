import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { BuildPublic } from '../../lib/api/types/builds';
import { fakeApi } from '../review/testing/fakeApi';
import { RunView } from './RunView';
import { build, plan, planVersion } from './testing';

const commits = [
  { sha: 'aaaaaaa1111', subject: 'chore: seed from attention', at: '2026-10-03T10:00:00Z' },
  { sha: 'bbbbbbb2222', subject: 'feat(model): attention', at: '2026-10-03T10:10:00Z' },
];

const running = (over: Partial<BuildPublic> = {}) =>
  build({
    state: 'building',
    run_job_id: 'j2',
    repo_url: 'https://github.com/me/tiny-transformer',
    commits,
    elapsed_seconds: 30 * 60,
    cost_usd: 1,
    stops: { max_minutes: 90, max_commits: 30, max_budget_usd: 4, done_when: [] },
    ...over,
  });

/** Holds the build the way the studio does, so a poll's answer re-renders the view. */
function Harness({ initial, api, pollMs }: { initial: BuildPublic; api: ReturnType<typeof fakeApi>['api']; pollMs?: number }) {
  const [b, setB] = useState(initial);
  return <RunView build={b} api={api} onChange={setB} onDeleted={() => undefined} pollMs={pollMs} />;
}

describe('<RunView>', () => {
  it('shows each limit as a meter and the commits newest first, linked to GitHub', () => {
    const { api } = fakeApi();
    render(<RunView build={running()} api={api} onChange={vi.fn()} onDeleted={vi.fn()} pollMs={60_000} />);

    const meters = screen.getAllByRole('meter');
    expect(meters.map((m) => m.getAttribute('aria-valuetext'))).toEqual(['30 of 90 min', '2 of 30', '$1.00 of $4.00']);
    const links = screen.getAllByRole('link').filter((a) => a.getAttribute('href')?.includes('/commit/'));
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['bbbbbbb', 'https://github.com/me/tiny-transformer/commit/bbbbbbb2222'],
      ['aaaaaaa', 'https://github.com/me/tiny-transformer/commit/aaaaaaa1111'],
    ]);
    expect(screen.getByRole('link', { name: /me\/tiny-transformer/ })).toBeTruthy();
  });

  it('shows plain shas for a local build', () => {
    const { api } = fakeApi();
    render(<RunView build={running({ state: 'stopped', repo_url: null, stop_reason: 'max_minutes' })} api={api} onChange={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.getByText('bbbbbbb', { selector: 'code' })).toBeTruthy();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('It ended because the time limit was reached.')).toBeTruthy();
  });

  it('stops a running build after asking', async () => {
    const { api, calls } = fakeApi({ 'POST builds/b1/stop': () => running({ state: 'stopping' }) });
    const onChange = vi.fn();
    render(<RunView build={running()} api={api} onChange={onChange} onDeleted={vi.fn()} pollMs={60_000} />);

    await userEvent.click(screen.getByRole('button', { name: 'Stop the build' }));
    expect(calls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Stop it' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'stopping' })));
    expect(calls).toEqual([{ method: 'POST', path: 'builds/b1/stop', body: undefined }]);
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull();
  });

  it('polls while the build runs and stops once it is done', async () => {
    const answers = [running(), running({ state: 'done', stop_reason: 'goal_reached' })];
    const { api, calls } = fakeApi({ 'GET builds/b1': () => answers.shift() ?? running({ state: 'done' }) });
    render(<Harness initial={running()} api={api} pollMs={1} />);

    expect(await screen.findByText('It ended because the goal was reached.')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });

  it('continues a finished build with an extra goal and new limits', async () => {
    const done = running({ state: 'done', stop_reason: 'goal_reached' });
    const { api, calls } = fakeApi({ 'POST builds/b1/continue': () => running() });
    const onChange = vi.fn();
    render(<RunView build={done} api={api} onChange={onChange} onDeleted={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('What next (optional)'), 'add a training notebook');
    const minutes = screen.getByLabelText('Minutes');
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Continue the build' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls[0]).toEqual({
      method: 'POST',
      path: 'builds/b1/continue',
      body: { goal: 'add a training notebook', stops: { max_minutes: 30, max_commits: 30, max_budget_usd: 4, done_when: [] } },
    });
  });

  it('deletes a finished build after asking', async () => {
    const { api, calls } = fakeApi({ 'DELETE builds/b1': () => undefined });
    const onDeleted = vi.fn();
    render(<RunView build={running({ state: 'failed', error: 'gh repo create failed' })} api={api} onChange={vi.fn()} onDeleted={onDeleted} />);

    expect(screen.getByText('gh repo create failed')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Delete this build' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('b1'));
    expect(calls).toEqual([{ method: 'DELETE', path: 'builds/b1', query: undefined }]);
  });

  it('shows the report at the end, with how to run it', () => {
    const { api } = fakeApi();
    const report = { status: 'partial' as const, done: ['attention'], not_done: ['training'], next_steps: ['train longer'], run_it: 'uv run python train.py' };
    render(<RunView build={running({ state: 'stopped', stop_reason: 'max_commits', report })} api={api} onChange={vi.fn()} onDeleted={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Partly done' })).toBeTruthy();
    expect(screen.getByText('uv run python train.py')).toBeTruthy();
    expect(screen.getByText('training')).toBeTruthy();
  });

  it('links the pull request the run opened', () => {
    const { api } = fakeApi();
    render(<RunView build={running({ state: 'done', pr_url: 'https://github.com/me/tiny-transformer/pull/1' })} api={api} onChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole('link', { name: /Pull request/ }).getAttribute('href')).toBe('https://github.com/me/tiny-transformer/pull/1');
  });

  it('keeps a read-only plan history, loaded once opened, that marks the version that was built', async () => {
    const built = plan({ summary: 'Fewer steps.' });
    const { api, calls } = fakeApi({
      'GET builds/b1/plans': () => [planVersion({ version: 2, based_on: 1, feedback: 'fewer steps', plan: built, current: true }), planVersion({ version: 1 })],
    });
    render(<RunView build={running({ state: 'done', plan: built, plan_version: 2, plan_versions_count: 2 })} api={api} onChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(calls).toEqual([]);

    const toggle = screen.getByRole('button', { name: 'Plan history · 2 versions' });
    await userEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByRole('radio', { name: /^v2 Replanned · built/ })).toHaveProperty('checked', true);

    await userEvent.click(screen.getByRole('radio', { name: /^v1/ }));
    const banner = screen.getByRole('region', { name: 'Viewing v1' });
    expect(within(banner).queryByRole('button', { name: 'Use this version' })).toBeNull();
    await userEvent.click(within(banner).getByRole('button', { name: 'Compare with built' }));
    expect(screen.getByRole('region', { name: 'Changes from v1 to v2 (built)' })).toBeTruthy();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET builds/b1/plans']);
  });

  it('shows no plan history for a build with one plan', () => {
    const { api } = fakeApi();
    render(<RunView build={running()} api={api} onChange={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Plan history/ })).toBeNull();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BuildTarget } from '../../lib/api/types/builds';
import { fakeApi } from '../review/testing/fakeApi';
import { ApproveBlock } from './ApproveBlock';
import { build, options, target } from './testing';

const into = (t: BuildTarget, delivery: 'pull_request' | 'push_main' = 'pull_request') =>
  build({ options: options({ repo_name: null, target: t, advanced: { ...options().advanced, delivery } }) });

describe('<ApproveBlock>', () => {
  it('asks for a repository name for a new repository', () => {
    const { api } = fakeApi();
    render(<ApproveBlock build={build()} api={api} onChange={vi.fn()} />);
    expect(screen.getByLabelText('Repository name')).toHaveProperty('value', 'tiny-transformer');
    expect(screen.getByText(/Goes to a private GitHub repository/)).toBeTruthy();
  });

  it('restates a GitHub target and approves its options as they are', async () => {
    const b = into(target({ base_branch: 'main' }));
    const { api, calls } = fakeApi({ 'POST builds/b1/approve': () => b });
    const onChange = vi.fn();
    render(<ApproveBlock build={b} api={api} onChange={onChange} />);

    expect(screen.queryByLabelText('Repository name')).toBeNull();
    expect(screen.getByText('Into me/lab · papers/attention on build/attention → pull request into main.')).toBeTruthy();
    expect(screen.getByText(/a commit outside it is flagged/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Approve & start building' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(b));
    expect(calls[0]?.body).toEqual({ options: b.options, stops: b.stops });
  });

  it('says when the work goes straight onto the base branch', () => {
    const { api } = fakeApi();
    render(<ApproveBlock build={into(target({ confine: 'stop' }), 'push_main')} api={api} onChange={vi.fn()} />);
    expect(screen.getByText('Into me/lab · papers/attention on build/attention → pushed straight to the default branch.')).toBeTruthy();
    expect(screen.getByText(/a commit outside it stops the run/)).toBeTruthy();
  });

  it('restates a local target, which stays local', () => {
    const { api } = fakeApi();
    render(<ApproveBlock build={into(target({ kind: 'local', repo: null, path: '/Users/me/code/foo' }))} api={api} onChange={vi.fn()} />);
    expect(screen.getByText('Into ~/code/foo (local) · papers/attention on build/attention · stays local.')).toBeTruthy();
  });
});

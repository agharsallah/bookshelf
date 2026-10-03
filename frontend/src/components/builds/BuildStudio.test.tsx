import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { fakeApi } from '../review/testing/fakeApi';
import { settingsOf } from '../settings/testing';
import { BuildStudio } from './BuildStudio';
import { build, check, preflightOf } from './testing';

const older = build({ id: 'b0', goal: 'an interactive website explaining attention', state: 'done', run_job_id: 'j0' });
const newer = build({ id: 'b1', goal: 'a minimal PyTorch transformer for learning' });

describe('<BuildStudio>', () => {
  it('opens the newest build: a planned one shows its plan to review', async () => {
    const { api, calls } = fakeApi({ 'GET builds/b1': () => newer });
    render(<BuildStudio documentId="doc-1" paperRef="attention" paperTitle="Attention" initialBuilds={[newer, older]} api={api} />);

    expect(await screen.findByRole('button', { name: 'Approve & start building' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: newer.goal })).toBeTruthy();
    expect(calls.map((c) => c.path)).toEqual(['builds/b1']);
  });

  it('opens another build from the list', async () => {
    const { api } = fakeApi({ 'GET builds/b1': () => newer, 'GET builds/b0': () => older });
    render(<BuildStudio documentId="doc-1" paperRef="attention" paperTitle="Attention" initialBuilds={[newer, older]} api={api} />);

    await userEvent.click(screen.getByRole('button', { name: new RegExp(older.goal) }));

    expect(await screen.findByRole('heading', { name: older.goal })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Delete this build/ })).toBeTruthy();
  });

  it('starts on the form without builds, and lists the one it creates', async () => {
    const created = build({ id: 'b2', goal: 'a tiny attention demo', state: 'planning', plan: null });
    const { api } = fakeApi({
      'GET settings': () => settingsOf(),
      'GET builds/presets': () => [],
      'GET builds/preflight': () => preflightOf(check()),
      'POST papers/attention/builds': () => created,
      'GET builds/b2': () => created,
    });
    render(<BuildStudio documentId="doc-1" paperRef="attention" paperTitle="Attention" initialBuilds={[]} api={api} pollMs={60_000} />);

    await userEvent.type(await screen.findByLabelText('Goal'), created.goal);
    await screen.findByText(/All set/);
    await userEvent.click(screen.getByRole('button', { name: 'Draft the plan' }));

    expect(await screen.findByText(/Drafting the plan/)).toBeTruthy();
    expect(screen.getByRole('button', { name: new RegExp(created.goal) }).getAttribute('aria-current')).toBe('true');
  });
});

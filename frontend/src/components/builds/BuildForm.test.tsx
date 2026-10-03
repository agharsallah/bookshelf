import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Call } from '../review/testing/fakeApi';
import { fakeApi } from '../review/testing/fakeApi';
import { buildDefaults, settingsOf } from '../settings/testing';
import { BuildForm } from './BuildForm';
import { ADVANCED_DEFAULTS } from '../../lib/api/types/builds';
import { build, check, contextPreview, preflightOf, presets } from './testing';

const needsGh = check({ ok: false, message: 'gh is not signed in', fix: 'Sign in with `gh auth login`.' });

function setup(preflight: (call: Call) => unknown = () => preflightOf(check())) {
  const created = build({ state: 'planning', plan: null });
  const fake = fakeApi({
    'GET settings': () => settingsOf({ builds: buildDefaults({ max_budget_usd: 5, owner: 'lab' }) }),
    'GET builds/presets': () => presets,
    'GET builds/preflight': preflight,
    'GET papers/attention/builds/context': () => contextPreview(),
    'POST papers/attention/builds': () => created,
  });
  const onCreated = vi.fn();
  render(<BuildForm paperRef="attention" paperTitle="Attention Is All You Need" api={fake.api} onCreated={onCreated} />);
  return { ...fake, onCreated, created };
}

const submit = () => screen.getByRole('button', { name: 'Draft the plan' });

describe('<BuildForm>', () => {
  it('fills goal, stack and limits from the preset picked, all still editable', async () => {
    setup();
    await userEvent.click(await screen.findByRole('radio', { name: /Minimal PyTorch/ }));

    expect(screen.getByLabelText('Goal')).toHaveProperty('value', presets[0]?.goal);
    expect(screen.getByLabelText('Stack')).toHaveProperty('value', 'PyTorch');
    expect(screen.getByLabelText('Minutes')).toHaveProperty('value', '60');
    expect(screen.getByLabelText('Commits')).toHaveProperty('value', '15');
    expect(screen.getByLabelText('Budget (USD)')).toHaveProperty('value', '5');
    expect(screen.getByLabelText('Done when, line 1')).toHaveProperty('value', 'it trains on a toy task');

    await userEvent.click(screen.getByRole('radio', { name: /Something else/ }));
    expect(screen.getByLabelText('Goal')).toHaveProperty('value', '');
  });

  it('holds the submit while a required check fails, shows its fix, and checks again for a local build', async () => {
    const { calls } = setup((call) => ((call.query as { visibility: string }).visibility === 'local' ? preflightOf(check()) : preflightOf(needsGh)));

    expect(await screen.findByText(/gh is not signed in/)).toBeTruthy();
    expect(screen.getByText('gh auth login', { selector: 'code' })).toBeTruthy();
    expect(screen.getByText('! gh auth login')).toBeTruthy();
    expect(submit()).toHaveProperty('disabled', true);

    await userEvent.click(screen.getByRole('button', { name: 'Local only' }));

    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));
    expect(screen.getByText(/All set/)).toBeTruthy();
    expect(calls.filter((c) => c.path === 'builds/preflight').map((c) => c.query)).toEqual([
      { document: 'attention', visibility: 'private' },
      { document: 'attention', visibility: 'local' },
    ]);
  });

  it('posts the goal, options and stops as filled in', async () => {
    const { calls, onCreated, created } = setup();
    const goal = await screen.findByLabelText('Goal');
    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));

    await userEvent.type(goal, 'an interactive website explaining attention');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a line' }));
    await userEvent.type(screen.getByLabelText('Done when, line 1'), 'the demo runs in a browser');
    await userEvent.click(screen.getByRole('checkbox', { name: /Credit Claude/ }));
    await userEvent.click(submit());

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      goal: 'an interactive website explaining attention',
      preset: null,
      options: {
        repo_name: 'attention-is-all-you-need',
        visibility: 'private',
        owner: 'lab',
        claude_attribution: true,
        link_paper: true,
        stack: null,
        allow_web: false,
        context: { sections: null, notes: null },
        references: [],
        advanced: ADVANCED_DEFAULTS,
      },
      stops: { max_minutes: 90, max_commits: 30, max_budget_usd: 5, done_when: ['the demo runs in a browser'] },
    });
  });

  it('says what is wrong instead of sending a goal too short', async () => {
    const { calls } = setup();
    await userEvent.type(await screen.findByLabelText('Goal'), 'tiny');
    await waitFor(() => expect(submit()).toHaveProperty('disabled', false));
    await userEvent.click(submit());

    expect(await screen.findByText(/at least 10 characters/)).toBeTruthy();
    expect(screen.getByLabelText('Goal').getAttribute('aria-invalid')).toBe('true');
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});

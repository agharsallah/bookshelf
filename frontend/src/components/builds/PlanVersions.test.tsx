import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { BuildPublic } from '../../lib/api/types/builds';
import { fakeApi } from '../review/testing/fakeApi';
import { PlanDrafting } from './PlanDrafting';
import { PlanReview } from './PlanReview';
import { build, plan, planVersion } from './testing';

/** v3, your edit of the replan: Attention's commit and check reworded, Train swapped for Evaluate. */
const current = plan({
  stack: ['Python', 'JAX'],
  milestones: [
    plan().milestones[0]!,
    { title: 'Attention', commit: 'feat(model): multi-head attention', deliverable: 'attention.py', done_when: 'heads test passes' },
    { title: 'Evaluate', commit: 'feat(eval): copy accuracy', deliverable: 'eval.py', done_when: 'accuracy is reported' },
  ],
});

const versions = [
  planVersion({ version: 3, origin: 'human', based_on: 2, plan: current, current: true, model: null }),
  planVersion({ version: 2, based_on: 1, feedback: 'fewer milestones, use JAX', plan: plan({ stack: ['Python', 'JAX'] }) }),
  planVersion({ version: 1 }),
];

const reviewed = (over: Partial<BuildPublic> = {}) => build({ plan: current, plan_origin: 'human', plan_version: 3, plan_versions_count: 3, ...over });

/** Holds the build the way the studio does, so a restore re-renders the review. */
function Harness({ initial, api }: { initial: BuildPublic; api: ReturnType<typeof fakeApi>['api'] }) {
  const [b, setB] = useState(initial);
  return <PlanReview build={b} api={api} onChange={setB} />;
}

function setup(initial = reviewed()) {
  const fake = fakeApi({
    'GET builds/b1/plans': () => versions,
    'POST builds/b1/plans/1/restore': () => reviewed({ plan: plan(), plan_origin: 'skill', plan_version: 1 }),
  });
  render(<Harness initial={initial} api={fake.api} />);
  return fake;
}

const pill = (name: RegExp) => screen.getByRole('radio', { name });
const plansLoads = (calls: ReturnType<typeof fakeApi>['calls']) => calls.filter((c) => c.method === 'GET' && c.path === 'builds/b1/plans').length;

describe('plan versions in the review', () => {
  it('shows no strip and asks for nothing while there is one version', () => {
    const { calls } = setup(build());
    expect(screen.queryByRole('group', { name: 'Plan versions' })).toBeNull();
    expect(calls).toEqual([]);
  });

  it('lists the versions oldest first, each with its origin, the current one marked', async () => {
    setup();
    const strip = await screen.findByRole('group', { name: 'Plan versions' });
    expect(within(strip).getAllByRole('radio').map((r) => r.closest('label')?.textContent)).toEqual([
      'v1 Drafted',
      'v2 Replanned, feedback: fewer milestones, use JAX',
      'v3 Edited · current',
    ]);
    expect(pill(/^v3/)).toHaveProperty('checked', true);
    expect(pill(/^v2/).closest('label')?.getAttribute('title')).toBe('Replanned from v1 · feedback: fewer milestones, use JAX');
  });

  it('shows an older version read-only, with Edit, Replan and Approve out of the way', async () => {
    setup();
    await userEvent.click(await screen.findByRole('radio', { name: /^v1/ }));

    const banner = screen.getByRole('region', { name: 'Viewing v1' });
    expect(banner.textContent).toMatch(/Viewing v1 · Drafted/);
    expect(screen.getByText('Train')).toBeTruthy();
    expect(screen.getByText('feat(train): train on the copy task')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve & start building' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit milestones' })).toBeNull();
    expect(screen.queryByText('Replan with feedback')).toBeNull();

    await userEvent.click(within(banner).getByRole('button', { name: 'Back to current' }));
    expect(screen.getByRole('button', { name: 'Approve & start building' })).toBeTruthy();
    expect(pill(/^v3/)).toHaveProperty('checked', true);
  });

  it('moves through the versions with the arrow keys', async () => {
    setup();
    await screen.findByRole('group', { name: 'Plan versions' });
    pill(/^v3/).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(pill(/^v2/)).toHaveProperty('checked', true);
    expect(screen.getByRole('region', { name: 'Viewing v2' })).toBeTruthy();
  });

  it('makes an older version current again, then reloads the list', async () => {
    const { calls } = setup();
    await userEvent.click(await screen.findByRole('radio', { name: /^v1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Use this version' }));

    expect(calls).toContainEqual({ method: 'POST', path: 'builds/b1/plans/1/restore', body: undefined });
    expect(await screen.findByText('v1 is the plan again.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: /^Viewing/ })).toBeNull();
    expect(screen.getByText('feat(train): train on the copy task')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve & start building' })).toBeTruthy();
    await waitFor(() => expect(plansLoads(calls)).toBe(2));
  });

  it('compares an older version with the current plan, every mark said in words', async () => {
    setup();
    await userEvent.click(await screen.findByRole('radio', { name: /^v1/ }));
    const compare = screen.getByRole('button', { name: 'Compare with current' });
    await userEvent.click(compare);
    expect(compare.getAttribute('aria-pressed')).toBe('true');

    const diff = screen.getByRole('region', { name: 'Changes from v1 to v3 (current)' });
    const milestones = within(within(diff).getByRole('region', { name: 'Milestones' })).getAllByRole('listitem');
    // Each milestone opens with its marker, in words.
    expect(milestones.map((li) => li.firstElementChild?.firstElementChild?.textContent)).toEqual([
      'Unchanged',
      'Changed: commit, done when',
      'Removed',
      'Added',
    ]);
    expect(within(milestones[2]!).getByText('Train').tagName).toBe('DEL');
    expect(within(milestones[3]!).getByText('Evaluate').tagName).toBe('INS');
    const stack = within(diff).getByRole('region', { name: 'Stack' });
    expect(stack.textContent).toBe('StackAdded JAXRemoved PyTorch');
  });
});

describe('<PlanDrafting>', () => {
  it('keeps the previous plan in view, dimmed, while the next version is drafted', () => {
    const { api } = fakeApi();
    render(<PlanDrafting build={reviewed({ state: 'planning', plan_feedback: 'fewer milestones' })} api={api} onChange={() => undefined} pollMs={60_000} />);

    expect(screen.getByRole('status').textContent).toMatch(/^Drafting v4/);
    const previous = screen.getByRole('region', { name: 'The previous plan, v3' });
    expect(previous.getAttribute('aria-busy')).toBe('true');
    expect(within(previous).getByText('Evaluate')).toBeTruthy();
    expect(previous.textContent).toMatch(/“fewer milestones”/);
  });

  it('says only that the plan is being drafted the first time', () => {
    const { api } = fakeApi();
    render(<PlanDrafting build={build({ state: 'planning', plan: null, plan_version: null, plan_versions_count: 0 })} api={api} onChange={() => undefined} pollMs={60_000} />);
    expect(screen.getByRole('status').textContent).toMatch(/^Drafting the plan from the paper/);
    expect(screen.queryByRole('region')).toBeNull();
  });
});

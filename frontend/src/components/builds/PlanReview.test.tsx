import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BuildPlan } from '../../lib/api/types/builds';
import { fakeApi } from '../review/testing/fakeApi';
import { PlanReview } from './PlanReview';
import { build, contextView, plan } from './testing';

function setup() {
  const fake = fakeApi({
    'PUT builds/b1/plan': (call) => build({ plan: (call.body as { plan: BuildPlan }).plan, plan_origin: 'human' }),
    'POST builds/b1/replan': () => build({ state: 'planning' }),
    'POST builds/b1/approve': () => build({ state: 'building' }),
    'GET builds/b1/context': () => contextView(),
  });
  const onChange = vi.fn();
  render(<PlanReview build={build()} api={fake.api} onChange={onChange} />);
  return { ...fake, onChange };
}

/** The `i`th field labelled `label` (the editor repeats each label per milestone). */
function nth(label: string, i: number): HTMLElement {
  const field = screen.getAllByLabelText(label)[i];
  if (!field) throw new Error(`no field ${label} #${i}`);
  return field;
}

describe('<PlanReview>', () => {
  it('reads the plan: milestones in order with their commit, and the planner’s questions', () => {
    setup();
    expect(screen.getAllByText(/^(chore|feat)/).map((n) => n.textContent)).toEqual(plan().milestones.map((m) => m.commit));
    expect(screen.getByText('Should it use a tokenizer library?')).toBeTruthy();
  });

  it('saves edited milestones as the whole plan', async () => {
    const { calls, onChange } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Edit milestones' }));

    const title = nth('Title', 2);
    await userEvent.clear(title);
    await userEvent.type(title, 'Train it');
    await userEvent.click(screen.getByRole('button', { name: 'Move milestone 3 up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove milestone 1' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Add a milestone' }));
    const fresh = 2;
    await userEvent.type(nth('Title', fresh), 'Docs');
    await userEvent.type(nth('Commit message', fresh), 'docs: explain the model');
    await userEvent.type(nth('Deliverable', fresh), 'A README section');
    await userEvent.type(nth('Done when', fresh), 'it reads well');
    await userEvent.click(screen.getByRole('button', { name: 'Save the plan' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const sent = (calls.find((c) => c.method === 'PUT')?.body as { plan: BuildPlan }).plan;
    expect(sent.milestones.map((m) => [m.title, m.commit])).toEqual([
      ['Train it', 'feat(train): train on the copy task'],
      ['Attention', 'feat(model): scaled dot-product attention'],
      ['Docs', 'docs: explain the model'],
    ]);
    expect(sent.milestones[2]).toEqual({ title: 'Docs', commit: 'docs: explain the model', deliverable: 'A README section', done_when: 'it reads well' });
    expect(sent.summary).toBe(plan().summary);
  });

  it('refuses to save a plan under three milestones', async () => {
    const { calls } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Edit milestones' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove milestone 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save the plan' }));

    expect(screen.getByRole('alert').textContent).toMatch(/3 to 12 milestones/);
    expect(calls).toEqual([]);
  });

  it('asks for another plan with your feedback', async () => {
    const { calls, onChange } = setup();
    await userEvent.click(screen.getByText('Replan with feedback'));
    await userEvent.type(screen.getByLabelText('Feedback for the planner'), 'fewer milestones ');
    await userEvent.click(screen.getByRole('button', { name: 'Replan with this feedback' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'planning' })));
    expect(calls).toEqual([{ method: 'POST', path: 'builds/b1/replan', body: { feedback: 'fewer milestones' } }]);
  });

  it('approves with the planner’s repo name filling a blank one, and the limits restated', async () => {
    const { calls, onChange } = setup();
    expect(screen.getByLabelText('Repository name')).toHaveProperty('value', 'tiny-transformer');
    expect(screen.getByText('me/tiny-transformer')).toBeTruthy();
    expect(screen.getByText(/90 min · 30 commits · no budget cap/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Approve & start building' }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'building' })));
    expect(calls[0]).toEqual({
      method: 'POST',
      path: 'builds/b1/approve',
      body: { options: { ...build().options, repo_name: 'tiny-transformer' }, stops: build().stops },
    });
  });

  it('loads what the build received only when you open its Context tab, and once', async () => {
    const { calls } = setup();
    expect(calls).toEqual([]);

    await userEvent.click(screen.getByRole('tab', { name: 'Context' }));
    expect(await screen.findByText('From the workspace')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'PAPER.md' })).toBeTruthy();

    await userEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Context' }));
    expect(calls).toEqual([{ method: 'GET', path: 'builds/b1/context', query: undefined }]);
  });
});

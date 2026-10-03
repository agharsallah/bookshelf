import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { BuildCreate, BuildOptionsInput } from '../../lib/api/types/builds';
import type { PaperSummary } from '../../lib/api/types/papers';
import { fakeApi } from '../review/testing/fakeApi';
import { settingsOf } from '../settings/testing';
import { BuildForm } from './BuildForm';
import { build, check, contextPreview, contextView, preflightOf } from './testing';

const paper = (id: string, slug: string, title: string) => ({ id, slug, title, authors: ['Vaswani'], year: 2017 }) as PaperSummary;

function setup() {
  const fake = fakeApi({
    'GET settings': () => settingsOf(),
    'GET builds/presets': () => [],
    'GET builds/preflight': () => preflightOf(check()),
    'GET papers/attention/builds/context': () => contextPreview(),
    'POST papers/attention/builds/context/render': () => contextView({ source: 'rendered' }),
    'GET papers': () => ({ items: [paper('doc-1', 'attention', 'Attention Is All You Need'), paper('doc-9', 'bert', 'BERT')], total: 2, limit: 8, offset: 0 }),
    'POST papers/attention/builds': () => build({ state: 'planning', plan: null }),
  });
  const onCreated = vi.fn();
  render(<BuildForm paperRef="attention" paperTitle="Attention Is All You Need" api={fake.api} onCreated={onCreated} />);
  return { ...fake, onCreated };
}

/** Open "What the agent will read" once its summary has the preview's numbers. */
async function openContext() {
  const summary = await screen.findByText(/^Paper brief · 1.840 words · all 3 sections$/);
  await userEvent.click(summary);
  return summary;
}

async function submitted(calls: ReturnType<typeof setup>['calls']) {
  await userEvent.type(screen.getByLabelText('Goal'), 'a tiny transformer for learning');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Draft the plan' })).toHaveProperty('disabled', false));
  await userEvent.click(screen.getByRole('button', { name: 'Draft the plan' }));
  await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === 'papers/attention/builds')).toBe(true));
  return (calls.find((c) => c.path === 'papers/attention/builds')?.body as BuildCreate).options;
}

describe('<BuildForm> context', () => {
  it('switching a section off updates the summary and leaves it out of the build', async () => {
    const { calls } = setup();
    const summary = await openContext();

    await userEvent.click(screen.getByRole('switch', { name: 'Include Equations' }));

    expect(summary.textContent).toBe('Paper brief · 1 540 words · 2 of 3 sections');
    await userEvent.click(screen.getByRole('button', { name: 'Preview Results' }));
    expect(screen.getByText('| BLEU | 28.4 |')).toBeTruthy();
    const options = await submitted(calls);
    expect(options.context?.sections).toEqual(['tldr', 'question', 'core_ideas', 'how_it_works', 'setup', 'results', 'claims', 'limitations']);
  });

  it('a suggestion chip adds its reference once, then holds itself disabled', async () => {
    const { calls } = setup();
    await openContext();

    await userEvent.click(screen.getByRole('button', { name: 'Add tensor2tensor' }));

    expect(screen.getByRole('button', { name: 'tensor2tensor (added)' })).toHaveProperty('disabled', true);
    expect(screen.getByText(/1 reference$/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Note for tensor2tensor'), 'the reference implementation');
    const options = await submitted(calls);
    expect(options.references).toEqual([
      { kind: 'url', url: 'https://github.com/tensorflow/tensor2tensor', document_id: null, title: 'tensor2tensor', note: 'the reference implementation', snapshot: true },
    ]);
  });

  it('refuses a link that is not http(s), and names a good one by its host', async () => {
    setup();
    await openContext();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a link' }));
    const adder = screen.getByRole('group', { name: 'Add a link' });

    await userEvent.type(within(adder).getByLabelText('URL'), 'javascript:alert(1){Enter}');
    expect(within(adder).getByText('Only http and https links.')).toBeTruthy();

    await userEvent.clear(within(adder).getByLabelText('URL'));
    await userEvent.type(within(adder).getByLabelText('URL'), 'https://jalammar.github.io/illustrated-transformer/');
    await userEvent.click(within(adder).getByRole('switch', { name: /Snapshot/ }));
    await userEvent.click(within(adder).getByRole('button', { name: 'Add the link' }));

    expect(screen.getByText('jalammar.github.io', { selector: 'span:not([data-kind])' })).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/only a name/);
  });

  it('adds a paper from the shelf, never the paper being built', async () => {
    const { calls } = setup();
    await openContext();
    await userEvent.click(screen.getByRole('button', { name: '+ Add from shelf' }));
    await userEvent.type(screen.getByLabelText('Search your shelf'), 'transformer{Enter}');

    expect(await screen.findByText('1 found.')).toBeTruthy();
    expect(calls.find((c) => c.path === 'papers')?.query).toEqual({ q: 'transformer', limit: 8 });
    expect(screen.queryByRole('button', { name: 'Add Attention Is All You Need' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add BERT' }));

    expect(screen.getByRole('button', { name: 'Add BERT' })).toHaveProperty('disabled', true);
    const options = await submitted(calls);
    expect(options.references).toEqual([{ kind: 'shelf', url: null, document_id: 'doc-9', title: 'BERT', note: null, snapshot: false }]);
  });

  it('previews the files rendered from the form as it stands', async () => {
    const { calls } = setup();
    await openContext();
    await userEvent.type(screen.getByLabelText(/Your notes/), 'mind the masking');
    await userEvent.click(screen.getByRole('button', { name: 'Preview files' }));

    const dialog = await screen.findByRole('dialog', { name: 'What the agent will read' });
    expect(await within(dialog).findByText('Rendered preview')).toBeTruthy();
    const sent = (calls.find((c) => c.path === 'papers/attention/builds/context/render')?.body as { options: BuildOptionsInput }).options;
    expect(sent.context).toEqual({ sections: null, notes: 'mind the masking' });
  });
});

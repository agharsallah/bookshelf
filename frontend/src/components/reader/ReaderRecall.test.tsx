import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { JobPublic } from '../../lib/api/types/jobs';
import type { RecallGrade, RecallPublic } from '../../lib/api/types/recalls';
import type * as MermaidModule from '../../lib/mermaid';
import type { Panes } from './panes';
import { Reader } from './Reader';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), url: (p: string) => `/api/${p}` }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));
vi.mock('../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.resolve('<svg></svg>'),
}));
vi.mock('../../lib/highlight', () => ({ highlightCode: () => Promise.resolve(null) }));
// The job stream, driven by the test: `jobs` is what the stream has reported.
const stream = vi.hoisted(() => ({ jobs: {} as Record<string, unknown> }));
vi.mock('../../lib/hooks/useJobStream', () => ({
  useJobStream: () => ({ status: 'open', jobs: stream.jobs, queue: null, track: () => undefined }),
}));

function node(anchor: string, kind: TreeNode['kind'], extra: Partial<TreeNode> = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: null, page_from: 1, page_to: 1, meta: {}, children: [], ...extra };
}

const MISSED = 'Slack absorbs surprises.';
const unit = node('ch01', 'chapter', {
  heading: 'Stocks and flows',
  children: [
    node('ch01/s01', 'section', { heading: 'Running hot', children: [node('ch01/s01/p001', 'paragraph', { text: `Teams run hot. ${MISSED}` })] }),
    node('ch01/s02', 'section', { heading: 'Queues', children: [node('ch01/s02/p001', 'paragraph', { text: 'Queues grow quietly.' })] }),
  ],
});

const panes: Panes = {
  distillation: {
    id: 'a1', anchor: 'ch01', type: 'chapter_distillation', standing: 'approved', version: 1, origin: 'human', title: null,
    blocks: [{ type: 'paragraph', spans: [{ text: 'Slack absorbs surprises.', cites: ['ch01/s01/p001'] }] }],
  },
  summary: null,
  sections: [],
  figures: [],
};

const GRADE: RecallGrade = {
  ideas: [
    { id: 'I1', tier: 'core', text: MISSED, why: null, cites: ['ch01/s01/p001'], status: 'missed', feedback: 'Slack is absent.', cue: 'What does slack do?' },
    { id: 'I2', tier: 'key', text: 'Queues grow quietly.', why: null, cites: ['ch01/s02/p001'], status: 'recalled', feedback: 'You have the queues.' },
  ],
  question: { idea: 'I2', text: 'Why do queues grow unseen?', cites: ['ch01/s02/p001'] },
  comparison: null,
  prediction_id: null,
  origin: 'skill:grade-recall@1',
  model: 'fake',
  created_at: '2026-09-28T10:00:00Z',
};

const recall = (extra: Partial<RecallPublic> = {}): RecallPublic => ({
  id: 'r1', unit: 'ch01', kind: 'recall', raw: 'Queues grow.', created_at: '2026-09-28T10:00:00Z', grade: null, ...extra,
});
const job = { id: 'j1', kind: 'grade_recall', state: 'queued' } as JobPublic;

const reader = () => document.querySelector<HTMLElement>('[data-view]')!;
const columns = () => reader().querySelector<HTMLElement>('[aria-label="Text"]')!.parentElement!;

function renderReader(props: { unread?: boolean; recalls?: RecallPublic[] } = {}) {
  return render(
    <Reader
      document={{ id: 'doc-1', slug: 'flow', title: 'Flow' }}
      unit={unit}
      units={[{ anchor: 'ch01', heading: 'Stocks and flows' }]}
      panes={panes}
      notes={[]}
      codeHtml={{}}
      initialAnchor={null}
      truncated={false}
      {...props}
    />,
  );
}

class Observer {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeEach(() => {
  window.localStorage.clear();
  stream.jobs = {};
  Object.values(api).forEach((fn) => typeof fn === 'function' && 'mockReset' in fn && fn.mockReset());
  vi.stubGlobal('IntersectionObserver', Observer);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<Reader> closed-book recall', () => {
  it('hides the text while you write, grades what you wrote, and reopens the chapter with the gaps marked', async () => {
    const view = renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Recall this chapter' }));

    const sheet = screen.getByRole('dialog', { name: 'Recall: Stocks and flows' });
    expect(reader().dataset.recall).toBe('');
    expect(columns().inert).toBe(true);
    expect(within(sheet).queryByText(/Teams run hot/)).toBeNull();
    const submit = within(sheet).getByRole('button', { name: /Grade my recall/ });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    api.post.mockResolvedValueOnce({ ...recall(), job });
    await userEvent.type(within(sheet).getByRole('textbox'), 'Queues grow.');
    await userEvent.click(submit);
    expect(api.post).toHaveBeenCalledWith('documents/flow/recalls', { unit: 'ch01', kind: 'recall', raw: 'Queues grow.' });
    expect(within(sheet).getByRole('status').textContent).toMatch(/Grading your recall/);

    // The job finishes: the grade is fetched and shown.
    api.get.mockResolvedValueOnce([recall({ grade: GRADE })]);
    stream.jobs = { j1: { ...job, state: 'done' } };
    view.rerender(
      <Reader document={{ id: 'doc-1', slug: 'flow', title: 'Flow' }} unit={unit} units={[{ anchor: 'ch01', heading: 'Stocks and flows' }]} panes={panes} notes={[]} codeHtml={{}} initialAnchor={null} truncated={false} />,
    );
    expect(await screen.findByText('You recalled 1 of 2 key ideas.')).toBeTruthy();
    expect(screen.getByText('Slack is absent.')).toBeTruthy();
    expect(screen.getByText('Why do queues grow unseen?')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Reopen the chapter, gaps marked' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(reader().dataset.recall).toBeUndefined();
    expect(reader().dataset.salience).toBe('');
    const gap = within(document.querySelector<HTMLElement>('[data-source-anchor="ch01/s01/p001"]')!).getByText(MISSED);
    expect(gap.dataset.sal).toBe('core');
    expect(screen.getByText(/Last recall: 1 of 2 ideas/)).toBeTruthy();
  });

  it('r opens the sheet, Escape closes it', async () => {
    renderReader();
    await userEvent.keyboard('r');
    expect(screen.getByRole('dialog', { name: /Recall/ })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('<Reader> predict before reading', () => {
  it('an unread chapter asks first, showing only its headings, and keeps the prediction', async () => {
    renderReader({ unread: true });
    const card = screen.getByRole('dialog', { name: 'Before you read: Stocks and flows' });
    expect(within(card).getByText('Running hot')).toBeTruthy();
    expect(within(card).queryByText(/Teams run hot/)).toBeNull();
    expect(columns().inert).toBe(true);

    api.post.mockResolvedValueOnce(recall({ id: 'p1', kind: 'prediction', raw: 'It argues for slack.', job: null } as never));
    await userEvent.type(within(card).getByRole('textbox'), 'It argues for slack.');
    await userEvent.click(within(card).getByRole('button', { name: 'Save and read' }));

    expect(api.post).toHaveBeenCalledWith('documents/flow/recalls', { unit: 'ch01', kind: 'prediction', raw: 'It argues for slack.' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(columns().inert).toBe(false);
  });

  it('can be skipped, and is not asked again once there is a prediction or the chapter was opened', async () => {
    const first = renderReader({ unread: true });
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    first.unmount();

    renderReader({ unread: true, recalls: [recall({ kind: 'prediction' })] });
    expect(screen.queryByRole('dialog')).toBeNull();
    cleanup();
    renderReader({ unread: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

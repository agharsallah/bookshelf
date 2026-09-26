import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type * as MermaidModule from '../../lib/mermaid';
import type { LexTerm } from './lexicon';
import type { Panes } from './panes';
import { Reader } from './Reader';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), url: (p: string) => `/api/${p}` }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));
vi.mock('../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.resolve('<svg></svg>'),
}));
vi.mock('../../lib/highlight', () => ({ highlightCode: () => Promise.resolve(null) }));

function node(anchor: string, kind: TreeNode['kind'], extra: Partial<TreeNode> = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: null, page_from: 1, page_to: 1, meta: {}, children: [], ...extra };
}

const KEY = 'Slack is capacity you leave unplanned, so surprises never queue.';
const unit = node('ch01', 'chapter', {
  heading: 'Stocks and flows',
  children: [
    node('ch01/p001', 'paragraph', { text: `Teams run hot. ${KEY}` }),
    node('ch01/p002', 'paragraph', { text: 'Queues grow quietly until the waiting starts to hurt everyone.' }),
  ],
});

const panes: Panes = {
  distillation: {
    id: 'a1', anchor: 'ch01', type: 'chapter_distillation', standing: 'approved', version: 1, origin: 'human', title: null,
    blocks: [{ type: 'paragraph', spans: [{ text: 'Slack absorbs surprises.', cites: ['ch01/p001'] }] }],
  },
  summary: null,
  sections: [],
  figures: [],
};

const lexicon: LexTerm[] = [{ label: 'slack', forms: ['slack'], kind: 'concept', gloss: 'Unplanned capacity.', defines: [] }];

/** An IntersectionObserver the test drives: `scrollTo(anchor)` reports that block as in view. */
const observed = new Set<Element>();
let report: ((entries: Partial<IntersectionObserverEntry>[]) => void) | null = null;
class FakeObserver {
  constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
    report = callback;
  }
  observe = (el: Element) => observed.add(el);
  unobserve = (el: Element) => observed.delete(el);
  disconnect = () => observed.clear();
}

const block = (anchor: string) => document.querySelector<HTMLElement>(`[data-source-anchor="${anchor}"]`)!;
const reader = () => document.querySelector<HTMLElement>('[data-view]')!;

function scrollTo(anchor: string) {
  const target = block(anchor);
  if (observed.has(target)) act(() => report?.([{ target, isIntersecting: true }]));
}

function renderReader() {
  return render(
    <Reader
      document={{ id: 'doc-1', slug: 'flow', title: 'Flow' }}
      unit={unit}
      units={[{ anchor: 'ch01', heading: 'Stocks and flows' }]}
      panes={panes}
      notes={[]}
      codeHtml={{}}
      lexicon={lexicon}
      initialAnchor={null}
      truncated={false}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  api.post.mockReset();
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  observed.clear();
});

describe('<Reader> what-matters mode', () => {
  it('h marks the cited sentence and the term; the stroke draws once the block scrolls into view', async () => {
    renderReader();
    const sentence = within(block('ch01/p001')).getByText(KEY.slice('Slack'.length).trim());
    expect(reader().dataset.salience).toBeUndefined();
    expect(sentence.dataset.sal).toBe('core');

    await userEvent.keyboard('h');
    expect(reader().dataset.salience).toBe('');
    expect(block('ch01/p001').hasAttribute('data-lit')).toBe(false);
    scrollTo('ch01/p001');
    expect(block('ch01/p001').hasAttribute('data-lit')).toBe(true);

    // The term inside the sentence is its own run, carrying both marks.
    const term = within(block('ch01/p001')).getByText('Slack');
    expect(term.dataset.term).toBe(term.dataset.salId);
    expect(term.dataset.sal).toBe('core');
    // Runs keep their offsets, so selections and note highlights still map onto the text.
    expect(Number(term.dataset.o)).toBe('Teams run hot. '.length);
  });

  it('fills the key-ideas meter as ideas scroll past, cheers at the end, and remembers it', async () => {
    renderReader();
    await userEvent.keyboard('h');
    expect(screen.getByRole('button', { name: /0 of 1 key ideas/ })).toBeTruthy();
    scrollTo('ch01/p001');
    expect(screen.getByRole('button', { name: /All key ideas found/ }).dataset.done).toBe('');

    cleanup();
    renderReader();
    expect(await screen.findByRole('button', { name: /All key ideas found/ })).toBeTruthy();
  });

  it('a marked term opens its card: the definition, why it is marked, and keeping it as a highlight', async () => {
    api.post.mockResolvedValue({ id: 'n1', document_id: 'doc-1', anchor: 'ch01/p001', range: { start: 15, end: 20 }, raw: null, color: 'amber', target: 'source', artifact_id: null, block: null, quote: null, created_at: '2026-09-26T10:00:00Z', job: null });
    renderReader();
    await userEvent.keyboard('h');
    await userEvent.click(within(block('ch01/p001')).getByText('Slack'));

    const card = screen.getByRole('dialog', { name: 'Slack' });
    expect(within(card).getByText('Unplanned capacity.')).toBeTruthy();
    expect(within(card).getByText('Concept · first mention in this chapter')).toBeTruthy();

    await userEvent.click(within(card).getByRole('button', { name: 'Keep as highlight' }));
    expect(api.post).toHaveBeenCalledWith('notes', { document_id: 'doc-1', anchor: 'ch01/p001', range: { start: 15, end: 20 }, color: 'amber' });
    expect(await within(card).findByText('In your highlights')).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Slack' })).toBeNull();
  });

  it('opens no card while the mode is off, and . jumps to the next key idea while it is on', async () => {
    renderReader();
    fireEvent.click(within(block('ch01/p001')).getByText('Slack'));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.keyboard('h.');
    expect(block('ch01/p001').scrollIntoView).toHaveBeenCalled();
    expect(block('ch01/p001').classList.contains('is-flashing')).toBe(true);
  });

  it('explains the marks in the reading settings', async () => {
    renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Reading settings' }));
    await userEvent.click(screen.getByRole('switch', { name: /Mark what matters/ }));
    expect(reader().dataset.salience).toBe('');
    expect(within(screen.getByRole('list', { name: 'Mark key' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Core idea', 'Key point', 'Term']);
  });
});

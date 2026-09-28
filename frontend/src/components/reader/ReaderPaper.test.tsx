import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { Panes } from './panes';
import type { PaperReading } from './paper/types';
import { PREFS_STORAGE_KEY } from './prefs';
import { Reader } from './Reader';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), url: (p: string) => `/api/${p}` }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));
vi.mock('../../lib/highlight', () => ({ highlightCode: () => Promise.resolve(null) }));

function node(anchor: string, kind: TreeNode['kind'], extra: Partial<TreeNode> = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: null, page_from: 1, page_to: 1, meta: {}, children: [], ...extra };
}

const method = node('ch03', 'chapter', {
  heading: '3 Model',
  meta: { role: 'method' },
  children: [
    node('ch03/s01', 'section', {
      heading: '3.1 Attention',
      children: [
        node('ch03/s01/p001', 'paragraph', { text: 'Attention maps a query and a set of key-value pairs to an output.' }),
        node('ch03/s01/f001', 'figure', { meta: { image_path: 'x/f001.png', caption: 'Figure 1: The Transformer' } }),
        node('ch03/s01/p002', 'paragraph', { text: 'We call it scaled dot-product attention.' }),
      ],
    }),
  ],
});

const conclusion = node('ch06', 'chapter', {
  heading: '6 Conclusion',
  meta: { role: 'conclusion' },
  children: [node('ch06/p001', 'paragraph', { text: 'We presented the Transformer.' })],
});

const panes: Panes = { distillation: null, summary: null, sections: [], figures: [] };

const units = [
  { anchor: 'ch01', heading: 'Abstract' },
  { anchor: 'ch02', heading: '1 Introduction' },
  { anchor: 'ch03', heading: '3 Model' },
  { anchor: 'ch06', heading: '6 Conclusion' },
];

function paper(overrides: Partial<PaperReading> = {}): PaperReading {
  return {
    passes: [],
    units: [
      { anchor: 'ch01', heading: 'Abstract', role: 'abstract' },
      { anchor: 'ch02', heading: '1 Introduction', role: 'introduction' },
      { anchor: 'ch03', heading: '3 Model', role: 'method' },
      { anchor: 'ch06', heading: '6 Conclusion', role: 'conclusion' },
    ],
    marks: [],
    notation: null,
    questions: [],
    ...overrides,
  };
}

/** A distillation makes the chapter gradable, so an unread one may ask for a prediction. */
const gradable: Panes = {
  ...panes,
  distillation: {
    id: 'a1', anchor: 'ch03', type: 'chapter_distillation', standing: 'approved', version: 1, origin: 'human', title: null,
    blocks: [{ type: 'paragraph', spans: [{ text: 'Attention maps queries to outputs.', cites: ['ch03/s01/p001'] }] }],
  },
};

function renderReader(unit: TreeNode, paperData: PaperReading | null, extra: { unread?: boolean; panes?: Panes } = {}) {
  return render(
    <Reader
      document={{ id: 'doc-1', slug: 'attention', title: 'Attention Is All You Need' }}
      unit={unit}
      units={units}
      panes={extra.panes ?? panes}
      unread={extra.unread ?? false}
      notes={[]}
      codeHtml={{}}
      initialAnchor={null}
      truncated={false}
      paper={paperData}
    />,
  );
}

const block = (anchor: string) => document.querySelector<HTMLElement>(`[data-source-anchor="${anchor}"]`);
const storedPrefs = () => JSON.parse(window.localStorage.getItem(PREFS_STORAGE_KEY) ?? '{}') as { paperPasses?: Record<string, number> };

beforeEach(() => {
  window.localStorage.clear();
  Object.values(api).forEach((fn) => typeof fn === 'function' && 'mockReset' in fn && fn.mockReset());
  Element.prototype.scrollIntoView = vi.fn();
});

describe('<Reader> with a book', () => {
  it('has no three-pass control and ignores its shortcut', async () => {
    renderReader(method, null);
    expect(screen.queryByRole('button', { name: /^Passes/ })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(block('ch03/s01/p001')).not.toBeNull();
    expect(storedPrefs().paperPasses ?? {}).toEqual({});
    await userEvent.keyboard('?');
    expect(screen.queryByText(/Three-pass reading/)).toBeNull();
  });

  it('still asks for a prediction before an unread chapter, whatever the stored passes say', () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ paperPasses: { 'doc-1': 1 } }));
    renderReader(method, null, { unread: true, panes: gradable });
    expect(screen.getByRole('dialog', { name: /^Before you read/ })).toBeTruthy();
  });
});

describe('<Reader> with a paper', () => {
  it('skims a body section in pass 1 and shows the whole paper again when the mode is left', async () => {
    renderReader(method, paper());
    await userEvent.click(screen.getByRole('button', { name: /^Passes/ }));

    expect(storedPrefs().paperPasses).toEqual({ 'doc-1': 1 });
    expect(block('ch03/s01/p001')).toBeNull();
    expect(block('ch03/s01/f001')).not.toBeNull();
    expect(screen.getByText(/Set aside for this pass: 2 blocks/)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Three-pass reading' })).toBeTruthy();

    fireEvent.keyDown(document.body, { key: 'p' });
    await waitFor(() => expect(block('ch03/s01/p001')).not.toBeNull());
    expect(storedPrefs().paperPasses).toEqual({});
  });

  it('asks the usual prediction before an unread section only while three-pass mode is off', () => {
    const off = renderReader(method, paper(), { unread: true, panes: gradable });
    expect(screen.getByRole('dialog', { name: /^Before you read/ })).toBeTruthy();
    off.unmount();

    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ paperPasses: { 'doc-1': 1 } }));
    renderReader(method, paper(), { unread: true, panes: gradable });
    expect(screen.queryByRole('dialog', { name: /^Before you read/ })).toBeNull();
    expect(screen.getByRole('group', { name: 'Three-pass reading' })).toBeTruthy();
  });

  it('folds the text before the first heading as the opening, without repeating the unit title', async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ paperPasses: { 'doc-1': 1 } }));
    const withLead = { ...method, children: [node('ch03/p001', 'paragraph', { text: 'We now describe the model in four parts.' }), ...method.children] };
    renderReader(withLead, paper());
    const lead = block('ch03')!;
    expect(within(lead).queryByRole('heading')).toBeNull();
    expect(within(lead).getByText(/^Opening, set aside for this pass: 1 block/)).toBeTruthy();
    expect(within(lead).queryByText(/3 Model/)).toBeNull();
    await userEvent.click(within(lead).getByRole('button', { name: /Read it anyway.*Opening/ }));
    expect(block('ch03/p001')).not.toBeNull();
  });

  it('unfolds a set-aside section on request', async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ paperPasses: { 'doc-1': 1 } }));
    renderReader(method, paper());
    await userEvent.click(screen.getByRole('button', { name: /Read it anyway.*3\.1 Attention/ }));
    expect(block('ch03/s01/p001')).not.toBeNull();
  });

  it('ends pass 1 on the three questions, saved as a prediction on the abstract, then marks the pass done', async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ paperPasses: { 'doc-1': 1 } }));
    api.post.mockResolvedValue({ id: 'r1', unit: 'ch01', kind: 'prediction', raw: '', created_at: '', grade: null, job: null });
    api.put.mockResolvedValue({ document_id: 'doc-1', pass: 1, completed_at: '2026-09-28T10:00:00Z', note: null });
    renderReader(conclusion, paper());

    const card = screen.getByRole('region', { name: /End of pass 1/ });
    await userEvent.click(within(card).getByRole('button', { name: 'Finish pass 1' }));
    await userEvent.type(within(card).getByLabelText('What kind of paper is it?'), 'method');
    await userEvent.type(within(card).getByLabelText(/main contribution/i), 'Attention alone is enough for translation.');
    await userEvent.click(within(card).getByLabelText('Yes, read it properly'));
    await userEvent.click(within(card).getByRole('button', { name: 'Save and finish pass 1' }));

    await waitFor(() => expect(within(card).getByText('Pass 1 done')).toBeTruthy());
    expect(api.post).toHaveBeenCalledWith('documents/attention/recalls', {
      unit: 'ch01',
      kind: 'prediction',
      raw: 'Category: method\nMain contribution: Attention alone is enough for translation.\nWorth a second pass: yes',
    });
    expect(api.put).toHaveBeenCalledWith('papers/attention/passes/1', {});
    expect(within(card).getByRole('button', { name: 'Start pass 2' })).toBeTruthy();
  });

  it('marks pass 2 done with one button and does not ask again after a failure', async () => {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify({ paperPasses: { 'doc-1': 2 } }));
    api.put.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ document_id: 'doc-1', pass: 2, completed_at: '', note: null });
    renderReader(conclusion, paper());
    const card = screen.getByRole('region', { name: /End of pass 2/ });
    await userEvent.click(within(card).getByRole('button', { name: 'Mark pass 2 done' }));
    await waitFor(() => expect(within(card).getByRole('alert').textContent).toMatch(/Not saved/));
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(card).getByText('Pass 2 done')).toBeTruthy());
    expect(api.post).not.toHaveBeenCalled();
  });

  it('marks blocks that are evidence for a claim and opens the claim from the margin', async () => {
    api.get.mockResolvedValue({
      document_id: 'doc-1',
      artifact_id: 'a1',
      total: 1,
      units: [
        {
          unit: 'ch03',
          heading: '3 Model',
          role: 'method',
          claims: [
            {
              id: 'c1', document_id: 'doc-1', artifact_id: 'a1', key: 'C1', text: 'Self-attention alone matches recurrent encoders.', kind: 'method', strength: 'argued',
              evidence: ['ch03/s01/p002'], unit: 'ch03',
              relations: { supported_by: 1, contradicted_by: 0, extended_by: 0, supports: 0, extends: 0, proposed: 0 },
            },
          ],
        },
      ],
    });
    const marks = [{ anchor: 'ch03/s01/p002', claims: [{ id: 'c1', key: 'C1', strength: 'argued' as const }], supported_by: 1, contradicted_by: 0, extended_by: 0 }];
    renderReader(method, paper({ marks }));

    const markButton = screen.getByRole('button', { name: 'Claim C1: supported by 1 on your shelf' });
    expect(block('ch03/s01/p002')!.contains(markButton)).toBe(true);
    await userEvent.click(markButton);
    const popover = await screen.findByRole('dialog', { name: 'Claims resting on this passage' });
    await waitFor(() => expect(within(popover).getByText('Self-attention alone matches recurrent encoders.')).toBeTruthy());
    expect(api.get).toHaveBeenCalledWith('papers/attention/claims');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Claims resting on this passage' })).toBeNull());
  });
});

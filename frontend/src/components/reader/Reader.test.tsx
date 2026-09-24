import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { NoteDetail } from '../../lib/api/types/notes';
import type * as MermaidModule from '../../lib/mermaid';
import type { Panes } from './panes';
import { Reader } from './Reader';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), url: (p: string) => `/api/${p}` }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));
vi.mock('../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.resolve('<svg></svg>'),
}));
vi.mock('../../lib/highlight', () => ({ highlightCode: () => Promise.resolve(null) }));

function node(anchor: string, kind: TreeNode['kind'], extra: Partial<TreeNode> = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: null, page_from: 1, page_to: 1, meta: {}, children: [], ...extra };
}

const unit = node('ch01', 'chapter', {
  heading: 'Stocks and flows',
  children: [
    node('ch01/s01', 'section', {
      heading: 'Why it lags',
      children: [
        node('ch01/s01/p001', 'paragraph', { text: 'When a queue grows, people start more work.' }),
        node('ch01/s01/p002', 'paragraph', { text: 'Slack is not waste.', page_from: 2 }),
        node('ch01/s01/p003', 'paragraph', { text: '𝑥 grows when 𝑦 falls.', page_from: 2 }),
      ],
    }),
  ],
});

const panes: Panes = {
  distillation: {
    id: 'a1', anchor: 'ch01', type: 'chapter_distillation', standing: 'approved', version: 1, origin: 'human', title: null,
    blocks: [{ type: 'paragraph', spans: [{ text: 'Slack absorbs surprises.', cites: ['ch01/s01/p002'] }] }],
  },
  summary: null,
  sections: [],
  figures: [],
};

function renderReader(notes: NoteDetail[] = []) {
  return render(
    <Reader
      document={{ id: 'doc-1', slug: 'flow', title: 'Flow' }}
      unit={unit}
      units={[{ anchor: 'ch01', heading: 'Stocks and flows' }]}
      panes={panes}
      notes={notes}
      codeHtml={{}}
      initialAnchor={null}
      truncated={false}
    />,
  );
}

const block = (anchor: string) => document.querySelector<HTMLElement>(`[data-source-anchor="${anchor}"]`)!;

function selectInBlock(anchor: string, start: number, end: number) {
  const text = block(anchor).querySelector('[data-o]')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  fireEvent.mouseUp(block(anchor));
}

const created = (overrides: object) => ({
  id: 'n1', document_id: 'doc-1', anchor: 'ch01/s01/p001', range: null, raw: 'x', color: null, created_at: '2026-09-23T10:00:00Z', job: {}, ...overrides,
});

beforeEach(() => {
  api.post.mockReset();
  api.patch.mockReset();
  window.getSelection()?.removeAllRanges();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('<Reader>', () => {
  it('scrolls to and flashes the cited passage when a cite chip is clicked', async () => {
    renderReader();
    await userEvent.click(screen.getByRole('link', { name: '1.1 ¶2, source ch01/s01/p002' }));
    const target = block('ch01/s01/p002');
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(target.classList.contains('is-flashing')).toBe(true);
    expect(document.activeElement).toBe(target);
  });

  it('lights up what cites a passage while it is hovered', () => {
    renderReader();
    fireEvent.mouseOver(block('ch01/s01/p002').querySelector('p')!);
    const chip = screen.getByRole('link', { name: '1.1 ¶2, source ch01/s01/p002' });
    expect(chip.classList.contains('is-cited')).toBe(true);
    fireEvent.mouseLeave(document.querySelector('article')!);
    expect(chip.classList.contains('is-cited')).toBe(false);
  });

  it('highlights a selection with the chosen colour: offsets in the block text, no words', async () => {
    api.post.mockResolvedValue(created({ range: { start: 7, end: 18 }, raw: null, color: 'sage', job: null }));
    renderReader();
    selectInBlock('ch01/s01/p001', 7, 18);
    await userEvent.click(await screen.findByRole('button', { name: 'Highlight sage' }));

    expect(api.post).toHaveBeenCalledWith('notes', {
      document_id: 'doc-1',
      anchor: 'ch01/s01/p001',
      range: { start: 7, end: 18 },
      color: 'sage',
    });
    const mark = await within(block('ch01/s01/p001')).findByText('queue grows');
    expect(mark.closest('mark')?.dataset.color).toBe('sage');
  });

  // The backend validates and slices ranges in code points (Python); the DOM counts UTF-16 units.
  it('sends and shows ranges in code points when the text has astral characters', async () => {
    api.post.mockResolvedValue(created({ anchor: 'ch01/s01/p003', range: { start: 15, end: 20 }, raw: null, color: 'sage', job: null }));
    renderReader();
    selectInBlock('ch01/s01/p003', 17, 22);
    await userEvent.click(await screen.findByRole('button', { name: 'Highlight sage' }));

    expect(api.post).toHaveBeenCalledWith('notes', expect.objectContaining({ range: { start: 15, end: 20 } }));
    const mark = await within(block('ch01/s01/p003')).findByText('falls');
    expect(mark.closest('mark')?.dataset.color).toBe('sage');
  });

  it('saves what you type as the note, verbatim', async () => {
    api.post.mockResolvedValue(created({ range: { start: 0, end: 4 }, raw: '  Is this the delay?\n', color: 'amber' }));
    renderReader();
    selectInBlock('ch01/s01/p001', 0, 4);
    await userEvent.click(await screen.findByRole('button', { name: 'Note' }));
    await userEvent.type(screen.getByLabelText('Your note, kept exactly as you write it'), '  Is this the delay?{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(api.post).toHaveBeenCalledWith('notes', expect.objectContaining({ range: { start: 0, end: 4 }, raw: '  Is this the delay?\n', color: 'amber' }));
  });

  it('gives an existing highlight its words once, with PATCH', async () => {
    const highlight: NoteDetail = { ...created({ range: { start: 7, end: 18 }, raw: null, color: 'sky' }), structured: null, detached: false };
    api.patch.mockResolvedValue({ ...highlight, raw: 'Why more work?' });
    renderReader([highlight]);
    await userEvent.click(screen.getByRole('button', { name: /Distillation/ }));
    await userEvent.click(screen.getByRole('tab', { name: /^Your notes/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    await userEvent.type(screen.getByLabelText(/Your words, kept exactly/), 'Why more work?');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(api.patch).toHaveBeenCalledWith('notes/n1', { raw: 'Why more work?' });
    expect(await screen.findByText('Why more work?')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add a note' })).toBeNull();
  });

  it('n opens a whole-block note on the focused block; Escape closes it', async () => {
    renderReader();
    act(() => block('ch01/s01/p002').focus());
    await userEvent.keyboard('n');
    expect(screen.getByRole('form', { name: 'New note' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('form', { name: 'New note' })).toBeNull();
  });

  it('returns focus to the block when the composer is closed or its note saved', async () => {
    api.post.mockResolvedValue(created({ anchor: 'ch01/s01/p002', raw: 'Why?' }));
    renderReader();
    act(() => block('ch01/s01/p002').focus());
    await userEvent.keyboard('n');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(block('ch01/s01/p002'));

    await userEvent.keyboard('n');
    await userEvent.type(screen.getByLabelText('Your note, kept exactly as you write it'), 'Why?');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: 'New note' })).toBeNull());
    expect(document.activeElement).toBe(block('ch01/s01/p002'));
  });

  it('Escape closes the contents popover and returns focus to its button', async () => {
    renderReader();
    const button = screen.getByRole('button', { name: 'Contents' });
    await userEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const [, popoverLink] = screen.getAllByRole('link', { name: /Why it lags/ });
    act(() => popoverLink?.focus());
    await userEvent.keyboard('{Escape}');
    expect([button.getAttribute('aria-expanded'), document.activeElement]).toEqual(['false', button]);
  });

  it('j and k move focus between blocks in reading order', async () => {
    renderReader();
    act(() => block('ch01/s01').focus());
    await userEvent.keyboard('j');
    expect(document.activeElement).toBe(block('ch01/s01/p001'));
    await userEvent.keyboard('jk');
    expect(document.activeElement).toBe(block('ch01/s01/p001'));
  });

  it('marks the page in the margin only when it changes', () => {
    renderReader();
    expect(screen.getAllByLabelText(/^Page \d+$/).map((el) => el.getAttribute('aria-label'))).toEqual(['Page 1', 'Page 2']);
  });
});

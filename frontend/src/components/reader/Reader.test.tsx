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
        node('ch01/s01/p004', 'paragraph', { text: 'For example, a team at capacity waits longer.', page_from: 2 }),
        node('ch01/s01/f001', 'figure', { page_from: 2, meta: { image_path: 'flow/ch01/f001.png', caption: 'Figure 1.1 The loop' } }),
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
  id: 'n1', document_id: 'doc-1', anchor: 'ch01/s01/p001', range: null, raw: 'x', color: null, target: 'source' as const, artifact_id: null, block: null, quote: null, created_at: '2026-09-23T10:00:00Z', job: {}, ...overrides,
});

beforeEach(() => {
  window.localStorage.clear();
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
    const highlight: NoteDetail = { ...created({ range: { start: 7, end: 18 }, raw: null, color: 'sky' }), structured: null, detached: false, passage: 'queue grows' };
    api.patch.mockResolvedValue({ ...highlight, raw: 'Why more work?' });
    renderReader([highlight]);
    await userEvent.click(screen.getByRole('button', { name: 'Distillation' }));
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

  it('sets the text as chosen in the reading settings and remembers it', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('article')!.closest<HTMLElement>('[data-view]')!;
    await userEvent.click(screen.getByRole('button', { name: 'Reading settings' }));
    const panel = screen.getByRole('dialog', { name: 'Reading settings' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Larger text' }));
    await userEvent.click(within(panel).getByRole('button', { name: /Sans/ }));
    await userEvent.click(within(panel).getByRole('button', { name: 'Justified' }));

    expect(reader.style.getPropertyValue('--reader-size')).toBe('1.25rem');
    expect(reader.style.getPropertyValue('--reader-font')).toBe('var(--font-ui)');
    expect(reader.style.getPropertyValue('--reader-align')).toBe('justify');
    expect(JSON.parse(window.localStorage.getItem('bookshelf:reader')!)).toMatchObject({ size: 4, font: 'sans', align: 'justify' });

    await userEvent.click(within(panel).getByRole('button', { name: 'Reset typography' }));
    expect(reader.style.getPropertyValue('--reader-size')).toBe('1.125rem');
  });

  it('Escape closes the reading settings and returns focus to their button', async () => {
    renderReader();
    const button = screen.getByRole('button', { name: 'Reading settings' });
    await userEvent.click(button);
    await userEvent.keyboard('{Escape}');
    expect([screen.queryByRole('dialog', { name: 'Reading settings' }), document.activeElement]).toEqual([null, button]);
  });

  it('f enters focus mode: both panes and the site chrome step aside; Escape leaves it', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    await userEvent.keyboard('f');
    expect([reader.dataset.focus, reader.dataset.rail, reader.dataset.pane]).toEqual(['', 'off', 'off']);
    expect(document.documentElement.dataset.readerFocus).toBe('');
    expect(screen.getByRole('button', { name: 'Focus mode' }).getAttribute('aria-pressed')).toBe('true');

    await userEvent.keyboard('{Escape}');
    expect(reader.dataset.focus).toBeUndefined();
    expect(document.documentElement.dataset.readerFocus).toBeUndefined();
    // Leaving focus brings back the panes as they were.
    expect([reader.dataset.rail, reader.dataset.pane]).toEqual([undefined, undefined]);
  });

  it('puts the distillation pane away and remembers it', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    await userEvent.click(screen.getByRole('button', { name: 'Distillation pane' }));
    expect(reader.dataset.pane).toBe('off');
    expect(JSON.parse(window.localStorage.getItem('bookshelf:reader')!)).toMatchObject({ pane: false });
    await userEvent.keyboard('d');
    expect(reader.dataset.pane).toBeUndefined();
  });

  it('t opens the contents popover where the rail does not fit', async () => {
    renderReader();
    await userEvent.keyboard('t');
    expect(screen.getByRole('button', { name: 'Contents' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('+ and - step the text size', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    await userEvent.keyboard('++-');
    expect(reader.style.getPropertyValue('--reader-size')).toBe('1.25rem');
  });

  it('c colour-codes passages by what they are, with a label and a key in the settings', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    expect(block('ch01/s01/p004').dataset.role).toBe('example');
    expect(block('ch01/s01/p001').dataset.role).toBeUndefined();

    await userEvent.keyboard('c');
    expect(reader.dataset.semantic).toBe('');
    expect(within(block('ch01/s01/p004')).getByText('Example')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Reading settings' }));
    expect(screen.getByRole('switch', { name: /Colour-code passages/ }).getAttribute('aria-checked')).toBe('true');
    expect(within(screen.getByRole('list', { name: 'Colour key' })).getAllByRole('listitem')).toHaveLength(7);
    await userEvent.click(screen.getByRole('switch', { name: /Colour-code passages/ }));
    expect(reader.dataset.semantic).toBeUndefined();
  });

  it('s spotlights the block being read; the switch in the settings says so', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    await userEvent.keyboard('s');
    expect(reader.dataset.spotlight).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Reading settings' }));
    expect(screen.getByRole('switch', { name: /Spotlight/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('? lists the reader shortcuts', async () => {
    renderReader();
    await userEvent.keyboard('?');
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(sheet).getByText('Focus mode')).toBeTruthy();
    expect(within(sheet).getByText('Colour-code quotes, examples, asides')).toBeTruthy();
  });

  it('shows how long the rest of the chapter should take', () => {
    renderReader();
    expect(screen.getByText('1 min left')).toBeTruthy();
  });

  // happy-dom is 1024px wide: the rail does not fit, so the pane is the only side pane on screen.
  it('lets the text take the whole page once no side pane is shown', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    expect(reader.dataset.layout).toBe('one');
    await userEvent.click(screen.getByRole('button', { name: 'Distillation pane' }));
    expect(reader.dataset.layout).toBe('fill');
    expect(screen.queryByRole('separator', { name: 'Text width' })).toBeNull();
  });

  it('drags the text width with one side pane shown, and remembers it', () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    const handle = screen.getByRole('separator', { name: 'Text width' });
    // happy-dom lays nothing out: the column's edge is at 0, so grabbing there keeps the edge under the pointer.
    fireEvent.pointerDown(handle, { button: 0, clientX: 0 });
    fireEvent.pointerMove(window, { clientX: 760 });
    expect(reader.dataset.resizing).toBe('');
    expect(reader.style.getPropertyValue('--reader-measure')).toBe('760px');
    fireEvent.pointerUp(window, { clientX: 760 });

    expect(reader.dataset.resizing).toBeUndefined();
    expect(JSON.parse(window.localStorage.getItem('bookshelf:reader')!)).toMatchObject({ measure: 760 });
    expect(handle.getAttribute('aria-valuenow')).toBe('760');

    fireEvent.doubleClick(handle);
    expect(reader.style.getPropertyValue('--reader-measure')).toBe('40rem');
  });

  it('nudges the text width with the arrow keys; Enter goes back to the preset', async () => {
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    act(() => screen.getByRole('separator', { name: 'Text width' }).focus());
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Shift>}{ArrowLeft}{/Shift}');
    expect(reader.style.getPropertyValue('--reader-measure')).toBe(`${40 * 16 + 32 - 64}px`);
    await userEvent.keyboard('{Enter}');
    expect(reader.style.getPropertyValue('--reader-measure')).toBe('40rem');
  });

  it('keeps the width preset in focus mode', async () => {
    window.localStorage.setItem('bookshelf:reader', JSON.stringify({ measure: 900, focus: true }));
    renderReader();
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    expect(reader.dataset.layout).toBe('focus');
    expect(reader.style.getPropertyValue('--reader-measure')).toBe('40rem');
  });

  it('drags the text width with both side panes shown, where the rail fits', () => {
    const matchMedia = window.matchMedia;
    // A wide screen: the rail fits, one pane at a time does not apply.
    window.matchMedia = ((query: string) => {
      const list = matchMedia(query);
      Object.defineProperty(list, 'matches', { value: query.includes('min-width') });
      return list;
    }) as typeof window.matchMedia;
    try {
      window.localStorage.setItem('bookshelf:reader', JSON.stringify({ measure: 720 }));
      renderReader();
      const reader = document.querySelector<HTMLElement>('[data-view]')!;
      expect(reader.dataset.layout).toBe('both');
      expect(reader.style.getPropertyValue('--reader-measure')).toBe('720px');
      const handle = screen.getByRole('separator', { name: 'Text width' });
      fireEvent.pointerDown(handle, { button: 0, clientX: 0 });
      fireEvent.pointerMove(window, { clientX: 820 });
      fireEvent.pointerUp(window, { clientX: 820 });
      expect(JSON.parse(window.localStorage.getItem('bookshelf:reader')!)).toMatchObject({ measure: 820 });
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it('magnifies a figure in the lightbox, and "Show in text" lands back on it', async () => {
    renderReader();
    await userEvent.click(screen.getByRole('button', { name: 'Magnify: Figure 1.1 The loop' }));
    const lightbox = screen.getByRole('dialog', { name: 'Figure 1.1 The loop' });
    expect(within(lightbox).getByText('Page 2')).toBeTruthy();

    // Its keys stay in the lightbox: + zooms the figure, not the text.
    const reader = document.querySelector<HTMLElement>('[data-view]')!;
    await userEvent.keyboard('+');
    expect(reader.style.getPropertyValue('--reader-size')).toBe('1.125rem');

    await userEvent.click(within(lightbox).getByRole('button', { name: 'Show in text' }));
    expect(screen.queryByRole('dialog', { name: 'Figure 1.1 The loop' })).toBeNull();
    await waitFor(() => expect(block('ch01/s01/f001').classList.contains('is-flashing')).toBe(true));
  });
});

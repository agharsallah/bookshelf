// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteDetail } from '../../lib/api/types/notes';
import { blockText, paintPaneNotes, paneNoteAt, paneNoteRange, paneSelectionTarget } from './paneMarks';

// An entry as DistillPane renders it: top-level blocks, cite chips after spans.
function mount(): HTMLElement {
  const pane = document.createElement('div');
  pane.innerHTML = `
    <section data-scope="ch01" data-notable="a1" data-notable-target="chapter_distillation">
      <div data-blocks="">
        <div data-block="paragraph"><p>Slack <strong>absorbs</strong> surprises.<sup data-cites=""><a data-anchor="ch01/p002">1 ¶2</a></sup> Queues 𝑥 grow.</p></div>
        <div data-block="callout"><p>Takeaway</p><div data-blocks=""><div data-block="paragraph"><p>Nested</p></div></div></div>
      </div>
    </section>`;
  document.body.append(pane);
  return pane;
}

function select(start: [Node, number], end: [Node, number]): Selection {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

const note = (o: Partial<NoteDetail>): NoteDetail => ({
  id: 'n1', document_id: 'd', anchor: 'ch01', range: { start: 6, end: 13 }, raw: null, color: 'sky', target: 'chapter_distillation',
  artifact_id: 'a1', block: 0, quote: 'absorbs', created_at: '2026-01-01T00:00:00Z', structured: null, detached: false, passage: 'absorbs', ...o,
});

afterEach(() => {
  document.body.innerHTML = '';
  window.getSelection()?.removeAllRanges();
});

describe('blockText', () => {
  it('counts the prose and leaves cite chips out', () => {
    const block = mount().querySelector('[data-block]')!;
    expect(blockText(block)).toBe('Slack absorbs surprises. Queues 𝑥 grow.');
  });
});

describe('paneSelectionTarget', () => {
  it('turns a selection across marks into a block index, code-point range and quote', () => {
    const pane = mount();
    const p = pane.querySelector('p')!;
    const tail = p.lastChild!; // " Queues 𝑥 grow."
    const target = paneSelectionTarget(pane, select([p.firstChild!, 6], [tail, 10]))!;

    expect(target.anchor).toBe('ch01');
    expect(target.pane).toEqual({
      artifactId: 'a1',
      block: 0,
      quote: 'absorbs surprises. Queues 𝑥',
      range: { start: 6, end: 33 }, // the astral 𝑥 is one code point, two UTF-16 units
    });
  });

  it('refuses a selection spanning two blocks, or outside a notable entry', () => {
    const pane = mount();
    const [first, second] = pane.querySelectorAll('p');
    expect(paneSelectionTarget(pane, select([first!.firstChild!, 0], [second!.firstChild!, 3]))).toBeNull();

    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    pane.append(outside);
    expect(paneSelectionTarget(pane, select([outside.firstChild!, 0], [outside.firstChild!, 4]))).toBeNull();
  });
});

describe('paneNoteRange', () => {
  it('finds the marked words again, and gives up when the text changed', () => {
    const pane = mount();
    expect(paneNoteRange(pane, note({}))?.toString()).toBe('absorbs');
    expect(paneNoteRange(pane, note({ quote: 'other' }))).toBeNull();
    expect(paneNoteRange(pane, note({ artifact_id: 'a2' }))).toBeNull();
  });
});

describe('paintPaneNotes', () => {
  it('registers one highlight per colour and removes them on undo', () => {
    const registry = new Map<string, unknown>();
    vi.stubGlobal('CSS', { ...CSS, highlights: registry, escape: CSS.escape });
    vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...r: Range[]) { this.ranges = r; } });
    try {
      const pane = mount();
      const undo = paintPaneNotes(pane, [note({}), note({ id: 'n2', color: 'rose', range: { start: 0, end: 5 }, quote: 'Slack' })]);
      expect([...registry.keys()].sort()).toEqual(['note-rose', 'note-sky']);
      undo();
      expect(registry.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('paneNoteAt', () => {
  it('names the newest note under the caret', () => {
    const pane = mount();
    const strong = pane.querySelector('strong')!.firstChild!;
    const doc = document as Document & { caretRangeFromPoint?: unknown };
    doc.caretRangeFromPoint = () => {
      const r = document.createRange();
      r.setStart(strong, 2);
      return r;
    };
    try {
      const older = note({ id: 'old', range: { start: 0, end: 13 }, quote: 'Slack absorbs' });
      const newer = note({ id: 'new', created_at: '2026-02-01T00:00:00Z' });
      expect(paneNoteAt([older, newer], 0, 0)).toBe('new');
      expect(paneNoteAt([note({ range: { start: 20, end: 24 } })], 0, 0)).toBeNull();
    } finally {
      Reflect.deleteProperty(doc, 'caretRangeFromPoint');
    }
  });
});

/** The reader's notes beyond the source text: on the distillation/summary, and across the book. */
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { Panes } from './panes';
import { Reader } from './Reader';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), url: (p: string) => `/api/${p}` }));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));
vi.mock('../../lib/highlight', () => ({ highlightCode: () => Promise.resolve(null) }));

const paragraph = (anchor: string, text: string): TreeNode => ({
  id: anchor, anchor, kind: 'paragraph', ordinal: 0, depth: 1, heading: null, text, page_from: 1, page_to: 1, meta: {}, children: [],
});
const unit: TreeNode = { ...paragraph('ch01', ''), kind: 'chapter', depth: 0, text: null, heading: 'Stocks', children: [paragraph('ch01/p001', 'Slack is not waste.')] };

const panes: Panes = {
  distillation: {
    id: 'a1', anchor: 'ch01', type: 'chapter_distillation', standing: 'approved', version: 1, origin: 'skill', title: null,
    blocks: [{ type: 'paragraph', spans: [{ text: 'Slack absorbs surprises.', cites: ['ch01/p001'] }] }],
  },
  summary: null,
  sections: [],
  figures: [],
};

const note = (o: Partial<NoteDetail>): NoteDetail => ({
  id: 'n', document_id: 'doc-1', anchor: 'ch01/p001', range: null, raw: 'words', color: null, target: 'source', artifact_id: null,
  block: null, quote: null, created_at: '2026-09-23T10:00:00Z', structured: null, detached: false, passage: null, ...o,
});

function renderReader(notes: NoteDetail[] = []) {
  return render(
    <Reader
      document={{ id: 'doc-1', slug: 'flow', title: 'Flow' }}
      unit={unit}
      units={[
        { anchor: 'ch01', heading: 'Stocks' },
        { anchor: 'ch02', heading: 'Flows' },
      ]}
      panes={panes}
      notes={notes}
      codeHtml={{}}
      initialAnchor={null}
      truncated={false}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  api.post.mockReset();
  window.getSelection()?.removeAllRanges();
  Element.prototype.scrollIntoView = vi.fn();
});

describe('<Reader> pane and book notes', () => {
  it('highlights a passage of the distillation: artifact, block, code-point range and quote', async () => {
    api.post.mockResolvedValue({ ...note({ anchor: 'ch01', raw: null, target: 'chapter_distillation', artifact_id: 'a1', block: 0, range: { start: 6, end: 13 }, quote: 'absorbs' }), job: null });
    renderReader();
    const text = screen.getByText(/Slack absorbs surprises/).firstChild!;
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 13);
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(text.parentElement!);

    await userEvent.click(await screen.findByRole('button', { name: 'Highlight sky' }));

    expect(api.post).toHaveBeenCalledWith('notes', {
      document_id: 'doc-1',
      anchor: 'ch01',
      range: { start: 6, end: 13 },
      color: 'sky',
      artifact_id: 'a1',
      block: 0,
      quote: 'absorbs',
    });
    await userEvent.click(screen.getByRole('tab', { name: /^Your notes/ }));
    expect(within(screen.getByRole('article', { name: 'Note on ch01' })).getByText('absorbs')).toBeTruthy();
  });

  it('lists the whole book on request; the chapter tab counts only this chapter', async () => {
    renderReader([note({ id: 'mine', raw: 'here' }), note({ id: 'later', anchor: 'ch02/p004', raw: 'next chapter' })]);
    const tab = screen.getByRole('tab', { name: /^Your notes/ });
    expect(tab.textContent).toContain('1');
    await userEvent.click(tab);
    expect(screen.queryByText('next chapter')).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: /Whole book/ }));

    expect(within(screen.getByRole('region', { name: 'Flows' })).getByText('next chapter')).toBeTruthy();
  });
});

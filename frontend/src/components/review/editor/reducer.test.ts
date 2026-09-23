import { describe, expect, it } from 'vitest';
import type { RenderBlock } from '../../../lib/contract';
import { editorBody, editorReducer, initEditor, type EditorAction } from './reducer';

const body = {
  confidence: 'high',
  blocks: [
    { type: 'paragraph', spans: [{ text: 'Stocks lag flows.', cites: ['ch01/p001'] }] },
    { type: 'bullets', items: [[{ text: 'Delay', cites: [] }]] },
    { type: 'table', header: ['A', 'B'], rows: [[{ text: 'a1', cites: [] }, { text: 'b1', cites: [] }]] },
  ] satisfies RenderBlock[],
};

const run = (...actions: EditorAction[]) => editorBody(actions.reduce(editorReducer, initEditor(body)));
const blocks = (result: Record<string, unknown>) => result.blocks as RenderBlock[];
const at = { list: 0, block: 0, group: 0, span: 0 };

describe('editorReducer', () => {
  it('edits span text and keeps fields outside the blocks', () => {
    const result = run({ type: 'editSpan', at, patch: { text: 'Stocks lag behind flows.' } });
    expect(result.confidence).toBe('high');
    expect(blocks(result)[0]).toEqual({ type: 'paragraph', spans: [{ text: 'Stocks lag behind flows.', cites: ['ch01/p001'] }] });
  });

  it('adds a cite once and removes it', () => {
    const added = run({ type: 'addCite', at, anchor: 'ch01/p002' }, { type: 'addCite', at, anchor: 'ch01/p002' });
    expect(blocks(added)[0]).toMatchObject({ spans: [{ cites: ['ch01/p001', 'ch01/p002'] }] });
    const removed = run({ type: 'removeCite', at, anchor: 'ch01/p001' });
    expect(blocks(removed)[0]).toMatchObject({ spans: [{ cites: [] }] });
  });

  it('cites a table cell by its span group', () => {
    const result = run({ type: 'addCite', at: { list: 0, block: 2, group: 1, span: 0 }, anchor: 'ch02/p001' });
    expect(blocks(result)[2]).toMatchObject({ rows: [[{ cites: [] }, { text: 'b1', cites: ['ch02/p001'] }]] });
  });

  it('reorders, deletes and inserts blocks', () => {
    const moved = run({ type: 'moveBlock', list: 0, from: 0, to: 2 });
    expect(blocks(moved).map((b) => b.type)).toEqual(['bullets', 'table', 'paragraph']);
    const removed = run({ type: 'removeBlock', list: 0, block: 1 });
    expect(blocks(removed).map((b) => b.type)).toEqual(['paragraph', 'table']);
    const inserted = run({ type: 'insertBlock', list: 0, at: 1, block: 'callout', tone: 'remember' });
    expect(blocks(inserted)[1]).toEqual({ type: 'callout', tone: 'remember', spans: [{ text: '', cites: [] }] });
  });

  it('ignores a move past either end', () => {
    expect(blocks(run({ type: 'moveBlock', list: 0, from: 0, to: -1 })).map((b) => b.type)).toEqual(['paragraph', 'bullets', 'table']);
  });

  it('changes a callout tone and clears an optional field set to blank', () => {
    const toned = run(
      { type: 'insertBlock', list: 0, at: 0, block: 'callout' },
      { type: 'setField', list: 0, block: 0, field: 'tone', value: 'antipattern' },
      { type: 'setField', list: 0, block: 0, field: 'title', value: 'Beware' },
      { type: 'setField', list: 0, block: 0, field: 'title', value: '' },
    );
    expect(blocks(toned)[0]).toEqual({ type: 'callout', tone: 'antipattern', spans: [{ text: '', cites: [] }] });
  });

  it('adds and removes list items but never the last one', () => {
    const added = run({ type: 'addItem', list: 0, block: 1 });
    expect(blocks(added)[1]).toMatchObject({ items: [[{ text: 'Delay' }], [{ text: '' }]] });
    const kept = run({ type: 'removeItem', list: 0, block: 1, group: 0 });
    expect(blocks(kept)[1]).toMatchObject({ items: [[{ text: 'Delay' }]] });
  });

  it('adds a table row as wide as the header', () => {
    expect(blocks(run({ type: 'addRow', list: 0, block: 2 }))[2]).toMatchObject({ rows: [[{}, {}], [{ text: '' }, { text: '' }]] });
  });

  it('edits each brief section as its own list', () => {
    const brief = { sections: [{ key: 'thesis', title: 'Thesis', blocks: [{ type: 'heading', level: 2, text: 'Old' }] }, { key: 'read_next', title: 'Read next', blocks: [] }], read_next: [] };
    const state = initEditor(brief);
    expect(state.lists.map((l) => l.label)).toEqual(['Thesis']);
    const result = editorBody(editorReducer(state, { type: 'setField', list: 0, block: 0, field: 'text', value: 'New' }));
    expect(result).toEqual({ ...brief, sections: [{ ...brief.sections[0], blocks: [{ type: 'heading', level: 2, text: 'New' }] }, brief.sections[1]] });
  });

  it('marks the state dirty only after an edit', () => {
    const state = initEditor(body);
    expect(state.dirty).toBe(false);
    expect(editorReducer(state, { type: 'removeBlock', list: 0, block: 0 }).dirty).toBe(true);
  });
});

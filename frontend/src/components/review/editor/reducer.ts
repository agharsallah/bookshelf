/**
 * The structured block editor's state. Every edit is an action, so the editor's
 * behaviour is testable without a DOM and undo-free edits stay predictable.
 */
import type { CalloutTone, RenderBlock, Span } from '../../../lib/contract';
import {
  blockLists,
  blockTemplate,
  spanGroups,
  withBlockLists,
  withSpanGroups,
  type BlockList,
  type InsertableType,
} from './model';

export interface EditorState {
  /** The body the edit started from; fields outside the block lists are kept as-is. */
  base: Record<string, unknown>;
  lists: BlockList[];
  active: number;
  dirty: boolean;
}

/** Addresses one span: list → block → span group → span. */
export interface SpanRef {
  list: number;
  block: number;
  group: number;
  span: number;
}

export type BlockField = 'text' | 'level' | 'tone' | 'title' | 'term' | 'caption' | 'language' | 'latex' | 'attribution' | 'page';

export type EditorAction =
  | { type: 'setActive'; list: number }
  | { type: 'editSpan'; at: SpanRef; patch: Partial<Pick<Span, 'text' | 'mark'>> }
  | { type: 'addCite'; at: SpanRef; anchor: string }
  | { type: 'removeCite'; at: SpanRef; anchor: string }
  | { type: 'addSpan'; at: Omit<SpanRef, 'span'> }
  | { type: 'removeSpan'; at: SpanRef }
  | { type: 'addItem'; list: number; block: number }
  | { type: 'removeItem'; list: number; block: number; group: number }
  | { type: 'addRow'; list: number; block: number }
  | { type: 'setHeader'; list: number; block: number; column: number; text: string }
  | { type: 'setField'; list: number; block: number; field: BlockField; value: string | number | null }
  | { type: 'addBlockCite'; list: number; block: number; anchor: string }
  | { type: 'removeBlockCite'; list: number; block: number; anchor: string }
  | { type: 'insertBlock'; list: number; at: number; block: InsertableType; tone?: CalloutTone }
  | { type: 'removeBlock'; list: number; block: number }
  | { type: 'moveBlock'; list: number; from: number; to: number }
  | { type: 'replaceBody'; body: Record<string, unknown> };

export function initEditor(body: Record<string, unknown>): EditorState {
  return { base: body, lists: blockLists(body), active: 0, dirty: false };
}

/** The body to save: the base with every edited list written back. */
export function editorBody(state: EditorState): Record<string, unknown> {
  return withBlockLists(state.base, state.lists);
}

function updateBlock(state: EditorState, list: number, block: number, fn: (b: RenderBlock) => RenderBlock): EditorState {
  const target = state.lists[list]?.blocks[block];
  if (!target) return state;
  const lists = state.lists.map((l, i) =>
    i === list ? { ...l, blocks: l.blocks.map((b, j) => (j === block ? fn(b) : b)) } : l,
  );
  return { ...state, lists, dirty: true };
}

function updateBlocks(state: EditorState, list: number, fn: (blocks: RenderBlock[]) => RenderBlock[]): EditorState {
  if (!state.lists[list]) return state;
  const lists = state.lists.map((l, i) => (i === list ? { ...l, blocks: fn([...l.blocks]) } : l));
  return { ...state, lists, dirty: true };
}

function updateGroups(block: RenderBlock, fn: (groups: Span[][]) => Span[][]): RenderBlock {
  return withSpanGroups(block, fn(spanGroups(block).map((g) => [...g])));
}

function updateSpan(state: EditorState, at: SpanRef, fn: (s: Span) => Span): EditorState {
  return updateBlock(state, at.list, at.block, (block) =>
    updateGroups(block, (groups) =>
      groups.map((group, g) => (g === at.group ? group.map((s, n) => (n === at.span ? fn(s) : s)) : group)),
    ),
  );
}

const emptySpan = (): Span => ({ text: '', cites: [] });

function withField(block: RenderBlock, field: BlockField, value: string | number | null): RenderBlock {
  if (value === '' && field !== 'text' && field !== 'term' && field !== 'latex') {
    const { [field]: _dropped, ...rest } = block as unknown as Record<string, unknown>;
    return (field === 'page' ? { ...rest, page: null } : rest) as unknown as RenderBlock;
  }
  return { ...block, [field]: value } as RenderBlock;
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'setActive':
      return action.list >= 0 && action.list < state.lists.length ? { ...state, active: action.list } : state;
    case 'editSpan':
      return updateSpan(state, action.at, (span) => {
        const next = { ...span, ...action.patch };
        if (!next.mark) delete next.mark;
        return next;
      });
    case 'addCite':
      return updateSpan(state, action.at, (span) =>
        span.cites.includes(action.anchor) ? span : { ...span, cites: [...span.cites, action.anchor] },
      );
    case 'removeCite':
      return updateSpan(state, action.at, (span) => ({ ...span, cites: span.cites.filter((c) => c !== action.anchor) }));
    case 'addSpan':
      return updateBlock(state, action.at.list, action.at.block, (block) =>
        updateGroups(block, (groups) => groups.map((g, i) => (i === action.at.group ? [...g, emptySpan()] : g))),
      );
    case 'removeSpan':
      return updateBlock(state, action.at.list, action.at.block, (block) =>
        updateGroups(block, (groups) =>
          groups.map((g, i) => (i === action.at.group && g.length > 1 ? g.filter((_, n) => n !== action.at.span) : g)),
        ),
      );
    case 'addItem':
      return updateBlock(state, action.list, action.block, (block) =>
        block.type === 'bullets' || block.type === 'steps' ? { ...block, items: [...block.items, [emptySpan()]] } : block,
      );
    case 'removeItem':
      return updateBlock(state, action.list, action.block, (block) =>
        (block.type === 'bullets' || block.type === 'steps') && block.items.length > 1
          ? { ...block, items: block.items.filter((_, i) => i !== action.group) }
          : block,
      );
    case 'addRow':
      return updateBlock(state, action.list, action.block, (block) =>
        block.type === 'table' ? { ...block, rows: [...block.rows, block.header.map(emptySpan)] } : block,
      );
    case 'setHeader':
      return updateBlock(state, action.list, action.block, (block) =>
        block.type === 'table' ? { ...block, header: block.header.map((h, i) => (i === action.column ? action.text : h)) } : block,
      );
    case 'setField':
      return updateBlock(state, action.list, action.block, (block) => withField(block, action.field, action.value));
    case 'addBlockCite':
      return updateBlock(state, action.list, action.block, (block) =>
        'cites' in block && !block.cites.includes(action.anchor) ? { ...block, cites: [...block.cites, action.anchor] } : block,
      );
    case 'removeBlockCite':
      return updateBlock(state, action.list, action.block, (block) =>
        'cites' in block ? { ...block, cites: block.cites.filter((c) => c !== action.anchor) } : block,
      );
    case 'insertBlock':
      return updateBlocks(state, action.list, (blocks) => {
        const at = Math.max(0, Math.min(action.at, blocks.length));
        blocks.splice(at, 0, blockTemplate(action.block, action.tone));
        return blocks;
      });
    case 'removeBlock':
      return updateBlocks(state, action.list, (blocks) => blocks.filter((_, i) => i !== action.block));
    case 'moveBlock':
      return updateBlocks(state, action.list, (blocks) => {
        const moved = blocks[action.from];
        if (action.to < 0 || action.to >= blocks.length || !moved) return blocks;
        blocks.splice(action.from, 1);
        blocks.splice(action.to, 0, moved);
        return blocks;
      });
    case 'replaceBody':
      return { base: action.body, lists: blockLists(action.body), active: 0, dirty: true };
  }
}

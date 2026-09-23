/**
 * The editor's view of a body: one or more *block lists* (a `{blocks}` body has one; a
 * brief has one per section), and inside each block, *span groups* — the runs of spans
 * a person edits together (a paragraph, one list item, one table cell).
 */
import type { CalloutTone, RenderBlock, Span } from '../../../lib/contract';

export type BodyPath = readonly (string | number)[];

export interface BlockList {
  label: string;
  path: BodyPath;
  blocks: RenderBlock[];
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The block lists a structured editor can work on; empty when the body has none. */
export function blockLists(body: unknown): BlockList[] {
  if (!isRecord(body)) return [];
  if (Array.isArray(body.blocks)) {
    return [{ label: 'Body', path: ['blocks'], blocks: body.blocks as RenderBlock[] }];
  }
  if (Array.isArray(body.sections)) {
    return body.sections.flatMap((section, i): BlockList[] =>
      isRecord(section) && Array.isArray(section.blocks) && section.key !== 'read_next'
        ? [{ label: String(section.title ?? section.key ?? `Section ${i + 1}`), path: ['sections', i, 'blocks'], blocks: section.blocks as RenderBlock[] }]
        : [],
    );
  }
  return [];
}

function setIn(value: unknown, path: BodyPath, next: unknown): unknown {
  const [head, ...rest] = path;
  if (head === undefined) return next;
  if (typeof head === 'number') {
    const copy = Array.isArray(value) ? [...value] : [];
    copy[head] = setIn(copy[head], rest, next);
    return copy;
  }
  const copy: Json = isRecord(value) ? { ...value } : {};
  copy[head] = setIn(copy[head], rest, next);
  return copy;
}

/** The body with each list written back at its path; every other field is kept. */
export function withBlockLists(body: Json, lists: readonly BlockList[]): Json {
  return lists.reduce<Json>((acc, list) => setIn(acc, list.path, list.blocks) as Json, body);
}

/** The editable span groups of a block, in reading order. */
export function spanGroups(block: RenderBlock): Span[][] {
  switch (block.type) {
    case 'paragraph':
    case 'callout':
    case 'definition':
      return [block.spans];
    case 'bullets':
    case 'steps':
      return block.items;
    case 'table':
      return block.rows.flatMap((row) => row.map((cell) => [cell]));
    case 'math':
      return block.meaning ? [block.meaning] : [];
    default:
      return [];
  }
}

/** The block with its span groups replaced (same shape `spanGroups` produced). */
export function withSpanGroups(block: RenderBlock, groups: Span[][]): RenderBlock {
  switch (block.type) {
    case 'paragraph':
    case 'callout':
    case 'definition':
      return { ...block, spans: groups[0] ?? [] };
    case 'bullets':
    case 'steps':
      return { ...block, items: groups };
    case 'table': {
      const width = block.header.length || 1;
      const rows: Span[][] = [];
      groups.forEach((group, i) => {
        const r = Math.floor(i / width);
        (rows[r] ??= []).push(group[0] ?? { text: '', cites: [] });
      });
      return { ...block, rows };
    }
    case 'math':
      return groups[0] ? { ...block, meaning: groups[0] } : block;
    default:
      return block;
  }
}

/** Blocks a person can insert, with an empty template each. */
export const INSERTABLE = [
  'paragraph',
  'heading',
  'bullets',
  'steps',
  'callout',
  'definition',
  'quote',
  'table',
  'code',
  'math',
] as const;
export type InsertableType = (typeof INSERTABLE)[number];

const empty = (): Span => ({ text: '', cites: [] });

export function blockTemplate(type: InsertableType, tone: CalloutTone = 'important'): RenderBlock {
  switch (type) {
    case 'paragraph':
      return { type, spans: [empty()] };
    case 'heading':
      return { type, level: 2, text: '' };
    case 'bullets':
    case 'steps':
      return { type, items: [[empty()]] };
    case 'callout':
      return { type, tone, spans: [empty()] };
    case 'definition':
      return { type, term: '', spans: [empty()] };
    case 'quote':
      return { type, text: '', cites: [], page: null };
    case 'table':
      return { type, header: ['', ''], rows: [[empty(), empty()]] };
    case 'code':
      return { type, text: '', cites: [] };
    case 'math':
      return { type, latex: '', cites: [] };
  }
}

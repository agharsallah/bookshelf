/**
 * TypeScript mirror of the render contract (contracts/render-blocks.schema.json,
 * ARCHITECTURE.md §9). The block set is closed: adding a type means changing the
 * schema, the backend gates and `components/blocks` in the same commit.
 */

/** Stable block address, e.g. `ch03/s02/p014`. */
export type Anchor = string;

/** Up to 20 unique anchors a claim is grounded in. */
export type Cites = Anchor[];

export type Mark = 'strong' | 'em' | 'highlight' | 'code';

/** A run of text with its citations; the leaf every claim is made of. */
export interface Span {
  text: string;
  cites: Cites;
  mark?: Mark;
}

/** 1–40 spans. */
export type Spans = Span[];

export type Confidence = 'high' | 'medium' | 'low';

export const CALLOUT_TONES = [
  'important',
  'remember',
  'antipattern',
  'insight',
  'caution',
  'contrast',
  'question',
] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const HIGHLIGHT_COLORS = ['amber', 'rose', 'sage', 'sky', 'violet'] as const;
export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface HeadingBlock {
  type: 'heading';
  level: 2 | 3 | 4;
  text: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  spans: Spans;
}

export interface BulletsBlock {
  type: 'bullets';
  items: Spans[];
}

export interface StepsBlock {
  type: 'steps';
  items: Spans[];
}

export interface TableBlock {
  type: 'table';
  caption?: string;
  header: string[];
  /** Each row is a list of cells; each cell is a single span. */
  rows: Span[][];
}

export type ChartKind = 'bar' | 'line' | 'scatter';

export interface ChartSeries {
  name: string;
  /** Aligned with `x.values`; `null` is a gap. */
  values: (number | null)[];
}

export interface ChartBlock {
  type: 'chart';
  kind: ChartKind;
  title?: string;
  x: { label: string; values: (string | number)[] };
  y?: { label?: string };
  series: ChartSeries[];
  cites: Cites;
  confidence?: Confidence;
}

export interface DiagramNode {
  id: string;
  label: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramBlock {
  type: 'diagram';
  direction?: 'LR' | 'TD';
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  cites: Cites;
  confidence?: Confidence;
}

export interface CalloutBlock {
  type: 'callout';
  tone: CalloutTone;
  title?: string;
  spans: Spans;
}

export interface CodeBlock {
  type: 'code';
  language?: string;
  text: string;
  caption?: string;
  cites: Cites;
}

export interface MathBlock {
  type: 'math';
  latex: string;
  meaning?: Spans;
  cites: Cites;
}

export interface QuoteBlock {
  type: 'quote';
  text: string;
  attribution?: string;
  cites: Cites;
  page: number | null;
}

export interface DefinitionBlock {
  type: 'definition';
  term: string;
  spans: Spans;
}

/** The closed set of twelve render blocks, discriminated on `type`. */
export type RenderBlock =
  | HeadingBlock
  | ParagraphBlock
  | BulletsBlock
  | StepsBlock
  | TableBlock
  | ChartBlock
  | DiagramBlock
  | CalloutBlock
  | CodeBlock
  | MathBlock
  | QuoteBlock
  | DefinitionBlock;

export type BlockType = RenderBlock['type'];

/** Narrow a union member by its `type`. */
export type BlockOf<T extends BlockType> = Extract<RenderBlock, { type: T }>;

/** An artifact body as stored and served by the backend. */
export interface RenderDocument {
  blocks: RenderBlock[];
}

export const BLOCK_TYPES = [
  'heading',
  'paragraph',
  'bullets',
  'steps',
  'table',
  'chart',
  'diagram',
  'callout',
  'code',
  'math',
  'quote',
  'definition',
] as const satisfies readonly BlockType[];

/** Every span a block contains, in reading order. Headings, charts, code, quotes and diagrams have none. */
export function spansOf(block: RenderBlock): Span[] {
  switch (block.type) {
    case 'paragraph':
    case 'callout':
    case 'definition':
      return block.spans;
    case 'bullets':
    case 'steps':
      return block.items.flat();
    case 'table':
      return block.rows.flat();
    case 'math':
      return block.meaning ?? [];
    default:
      return [];
  }
}

/** Visit every span in the given blocks, in reading order, with its block index. */
export function walkSpans(
  blocks: readonly RenderBlock[],
  visit: (span: Span, blockIndex: number) => void,
): void {
  blocks.forEach((block, index) => {
    for (const span of spansOf(block)) visit(span, index);
  });
}

/** Block-level cites (charts, diagrams, code, math, quotes) that live outside spans. */
export function blockCites(block: RenderBlock): Cites {
  return 'cites' in block ? block.cites : [];
}

/**
 * Every anchor cited anywhere in the blocks, de-duplicated, in first-seen order.
 * Includes span cites and block-level cites.
 */
export function collectCites(blocks: readonly RenderBlock[]): Anchor[] {
  const seen = new Set<Anchor>();
  blocks.forEach((block) => {
    for (const span of spansOf(block)) span.cites.forEach((a) => seen.add(a));
    blockCites(block).forEach((a) => seen.add(a));
  });
  return [...seen];
}

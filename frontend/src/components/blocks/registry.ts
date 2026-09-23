/**
 * Block type → component. Typed as a complete mapping, so adding a type to the
 * contract without a component here is a compile error.
 */
import type { ComponentType } from 'react';
import type { BlockType } from '../../lib/contract';
import type { PreparedBlock } from '../../lib/prepare';
import { BulletsBlock } from './BulletsBlock';
import { CalloutBlock } from './CalloutBlock';
import { ChartBlock } from './ChartBlock';
import { CodeBlock } from './CodeBlock';
import { DefinitionBlock } from './DefinitionBlock';
import { DiagramBlock } from './DiagramBlock';
import { HeadingBlock } from './HeadingBlock';
import { MathBlock } from './MathBlock';
import { ParagraphBlock } from './ParagraphBlock';
import { QuoteBlock } from './QuoteBlock';
import { StepsBlock } from './StepsBlock';
import { TableBlock } from './TableBlock';

export type BlockComponents = {
  [T in BlockType]: ComponentType<{ block: Extract<PreparedBlock, { type: T }> }>;
};

export const BLOCK_COMPONENTS: BlockComponents = {
  heading: HeadingBlock,
  paragraph: ParagraphBlock,
  bullets: BulletsBlock,
  steps: StepsBlock,
  table: TableBlock,
  chart: ChartBlock,
  diagram: DiagramBlock,
  callout: CalloutBlock,
  code: CodeBlock,
  math: MathBlock,
  quote: QuoteBlock,
  definition: DefinitionBlock,
};

/** The component for a block, or undefined when the type is outside the contract. */
export function componentFor(type: unknown): ComponentType<{ block: PreparedBlock }> | undefined {
  if (typeof type !== 'string' || !Object.hasOwn(BLOCK_COMPONENTS, type)) return undefined;
  return BLOCK_COMPONENTS[type as BlockType] as ComponentType<{ block: PreparedBlock }>;
}

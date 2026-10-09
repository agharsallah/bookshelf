/**
 * One renderer per pill kind (docs/PILLS.md §2). The set is closed, and the record's type
 * makes a missing kind a compile error.
 */
import type { ComponentType } from 'react';
import type { Pill, PillKind } from '../../../lib/pills/types';
import { FlipPill, QuizPill, ReviewPill } from './ActiveKinds';
import type { KindContext, KindProps } from './context';
import { ClaimPill, ConnectionPill } from './LinkKinds';
import { DiagramPill, FigurePill, ListenPill, MathPill } from './MediaKinds';
import { AntipatternPill, DefinitionPill, HookPill, InsightPill, NumberPill, QuotePill, RememberPill } from './TextKinds';

const RENDERERS: { [K in PillKind]: ComponentType<KindProps<K>> } = {
  insight: InsightPill,
  remember: RememberPill,
  antipattern: AntipatternPill,
  quote: QuotePill,
  definition: DefinitionPill,
  number: NumberPill,
  figure: FigurePill,
  diagram: DiagramPill,
  quiz: QuizPill,
  flip: FlipPill,
  claim: ClaimPill,
  math: MathPill,
  connection: ConnectionPill,
  listen: ListenPill,
  hook: HookPill,
  review: ReviewPill,
};

export function PillBody({ pill, ctx }: { pill: Pill; ctx: KindContext }) {
  const Renderer = RENDERERS[pill.kind] as ComponentType<KindProps<PillKind>> | undefined;
  if (!Renderer) return <p>This pill cannot be shown here yet.</p>;
  return <Renderer pill={pill as never} ctx={ctx} />;
}

export type { AnswerValue, KindContext } from './context';

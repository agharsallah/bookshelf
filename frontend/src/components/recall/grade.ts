/**
 * What a graded recall means for the reader, as plain functions: the tally, the ideas
 * you missed or half-recalled as marks on the source text (drawn by the what-matters
 * mode: missed ideas with the core wash, partial ones with the key stroke), and whether
 * a chapter can be graded at all (it needs its salience marks or its distillation).
 */
import type { TreeNode } from '../../lib/api/types/documents';
import type { GradedIdea, IdeaStatus, RecallGrade, RecallPublic } from '../../lib/api/types/recalls';
import { locate } from '../reader/modelMarks';
import type { Panes } from '../reader/panes';
import type { Salient } from '../reader/salience';

export type Tally = Record<IdeaStatus, number> & { total: number };

export function tally(grade: RecallGrade): Tally {
  const out: Tally = { recalled: 0, partial: 0, missed: 0, total: grade.ideas.length };
  grade.ideas.forEach((idea) => (out[idea.status] += 1));
  return out;
}

export const STATUS_LABELS: Record<IdeaStatus, string> = {
  missed: 'Missed',
  partial: 'Partly recalled',
  recalled: 'Recalled',
};

/** Missed first: that is what to look at again. */
export const STATUS_ORDER: readonly IdeaStatus[] = ['missed', 'partial', 'recalled'];

export function byStatus(grade: RecallGrade): [IdeaStatus, GradedIdea[]][] {
  return STATUS_ORDER.map((status) => [status, grade.ideas.filter((i) => i.status === status)] as [IdeaStatus, GradedIdea[]]).filter(
    ([, ideas]) => ideas.length > 0,
  );
}

/**
 * The gaps of a grade as marks on `nodes`, in reading order. An idea copied from the text
 * (a salience mark) is marked where it stands; one written by the distillation marks the
 * whole passage it cites.
 */
export function gapMarks(grade: RecallGrade, nodes: readonly TreeNode[]): Salient[] {
  const byAnchor = new Map(nodes.map((n, i) => [n.anchor, { text: n.text ?? '', at: i }]));
  const out: (Salient & { at: number })[] = [];
  for (const idea of grade.ideas) {
    if (idea.status === 'recalled') continue;
    const anchor = idea.cites.find((c) => byAnchor.get(c)?.text);
    const node = anchor ? byAnchor.get(anchor) : undefined;
    if (!anchor || !node) continue;
    const range = locate(node.text, idea.text) ?? { start: 0, end: node.text.length };
    out.push({
      id: `${anchor}@${range.start}`,
      anchor,
      ...range,
      tier: idea.status === 'missed' ? 'core' : 'key',
      title: STATUS_LABELS[idea.status],
      why: idea.feedback,
      gloss: null,
      source: 'recall',
      at: node.at,
    });
  }
  return out.sort((a, b) => a.at - b.at || a.start - b.start).map(({ at: _at, ...mark }) => mark);
}

/** A chapter can be graded once it has its salience marks (core or key) or a distillation. */
export function canGrade(panes: Pick<Panes, 'distillation'>, modelMarks: readonly Salient[] | null): boolean {
  return Boolean(panes.distillation) || Boolean(modelMarks?.some((m) => m.tier !== 'term'));
}

/** The newest graded recall of the chapter, if any (lists come newest first). */
export function latestGraded(recalls: readonly RecallPublic[]): RecallPublic | null {
  return recalls.find((r) => r.kind === 'recall' && r.grade) ?? null;
}

export function hasPrediction(recalls: readonly RecallPublic[]): boolean {
  return recalls.some((r) => r.kind === 'prediction');
}

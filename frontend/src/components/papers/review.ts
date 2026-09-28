/**
 * The review tab's view model (pure): the rubric as bar rows (one series, a fixed 5-point
 * scale, so bars compare across papers), the reproducibility checklist as status marks
 * (icon + word, never colour alone), counts for its summary, and the Socratic command.
 */
import type { ReproducibilityStatus } from '../../lib/api/types/papers';
import type { BarRow } from '../charts/HBars';
import type { ChecklistItem, PaperAssessment } from './study-bodies';
import { CRITERION_LABELS, ITEM_LABELS, STATUS_LABELS } from './study-labels';

export const RUBRIC_MAX = 5;
export const RUBRIC_SERIES = [{ key: 'score', label: 'Score', color: 'var(--series-1)' }] as const;

export function rubricRows(assessment: Pick<PaperAssessment, 'scores'>): BarRow[] {
  return assessment.scores
    .filter((s) => s.score > 0)
    .map((s) => ({ key: s.criterion, label: CRITERION_LABELS[s.criterion], values: { score: s.score }, valueLabel: `${s.score} of ${RUBRIC_MAX}` }));
}

export type StatusTone = 'good' | 'warning' | 'critical' | 'neutral';

export interface StatusMark {
  /** A glyph read with its word: ✓ reported, ◐ partly, ✕ missing, ? not said. */
  icon: string;
  label: string;
  tone: StatusTone;
}

const MARKS: Record<ReproducibilityStatus, Omit<StatusMark, 'label'>> = {
  yes: { icon: '✓', tone: 'good' },
  partial: { icon: '◐', tone: 'warning' },
  no: { icon: '✕', tone: 'critical' },
  unknown: { icon: '?', tone: 'neutral' },
};

export function statusMark(status: ReproducibilityStatus): StatusMark {
  return { ...MARKS[status], label: STATUS_LABELS[status] };
}

export interface ChecklistRow extends ChecklistItem {
  name: string;
  mark: StatusMark;
}

export function checklistRows(items: readonly ChecklistItem[]): ChecklistRow[] {
  return items.map((i) => ({ ...i, name: ITEM_LABELS[i.item], mark: statusMark(i.status) }));
}

/** "6 of 10 reported, 2 partly, 1 missing, 1 not said" (zero counts left out). */
export function checklistSummary(items: readonly ChecklistItem[]): string {
  const count = (s: ReproducibilityStatus) => items.filter((i) => i.status === s).length;
  const parts = [
    count('yes') ? `${count('yes')} of ${items.length} reported` : null,
    count('partial') ? `${count('partial')} partly` : null,
    count('no') ? `${count('no')} missing` : null,
    count('unknown') ? `${count('unknown')} not said` : null,
  ].filter((p): p is string => p !== null);
  return parts.join(', ');
}

/** What to type in Claude Code to argue with the reviewer, one question at a time. */
export function socraticCommand(slug: string): string {
  return `/review-paper ${slug} socratic`;
}

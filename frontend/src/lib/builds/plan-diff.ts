/**
 * Plan versions (docs/BUILDS.md §7b), told and compared: what to call a version, and what
 * changed between two plans: the summary, the stack, the milestones one by one (matched by
 * position, then by title) and the out-of-scope list. Pure: the components only render it.
 */
import type { BuildMilestone, BuildPlan, BuildPlanVersion } from '../api/types/builds';

/* ── Naming a version ─────────────────────────────────────────────────────────── */

export type VersionKind = 'drafted' | 'replanned' | 'edited';

/** A planner draft is the first one or a replan; a human version is your edit. */
export function versionKind(v: Pick<BuildPlanVersion, 'origin' | 'based_on'>): VersionKind {
  if (v.origin === 'human') return 'edited';
  return v.based_on === null ? 'drafted' : 'replanned';
}

const LABELS: Record<VersionKind, string> = { drafted: 'Drafted', replanned: 'Replanned', edited: 'Edited by you' };
const SHORT_LABELS: Record<VersionKind, string> = { drafted: 'Drafted', replanned: 'Replanned', edited: 'Edited' };

/** "Drafted", "Replanned" or "Edited by you". */
export const versionLabel = (v: Pick<BuildPlanVersion, 'origin' | 'based_on'>): string => LABELS[versionKind(v)];

/** The pill's word: "Drafted", "Replanned" or "Edited". */
export const versionShortLabel = (v: Pick<BuildPlanVersion, 'origin' | 'based_on'>): string => SHORT_LABELS[versionKind(v)];

/** "from v2" for a version that revised another, else "". */
export const basedOnNote = (v: Pick<BuildPlanVersion, 'based_on'>): string => (v.based_on === null ? '' : `from v${v.based_on}`);

/* ── Comparing two plans ──────────────────────────────────────────────────────── */

export const MILESTONE_FIELDS = ['title', 'commit', 'deliverable', 'done_when'] as const satisfies readonly (keyof BuildMilestone)[];
export type MilestoneField = (typeof MILESTONE_FIELDS)[number];

export const FIELD_LABELS: Record<MilestoneField, string> = { title: 'title', commit: 'commit', deliverable: 'deliverable', done_when: 'done when' };

export type MilestoneDiff =
  | { kind: 'added'; after: BuildMilestone }
  | { kind: 'removed'; before: BuildMilestone }
  | { kind: 'changed'; before: BuildMilestone; after: BuildMilestone; fields: MilestoneField[] }
  | { kind: 'same'; before: BuildMilestone; after: BuildMilestone };

export interface ListDiff {
  added: string[];
  removed: string[];
}

export interface PlanDiff {
  summary: { changed: boolean; before: string; after: string };
  stack: ListDiff;
  /** In the newer plan's order, each removed milestone after the one it followed. */
  milestones: MilestoneDiff[];
  outOfScope: ListDiff;
  /** Anything at all differs. */
  changed: boolean;
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Items of `after` not in `before`, and the other way round (compared trimmed). */
export function diffList(before: readonly string[], after: readonly string[]): ListDiff {
  const had = new Set(before.map((s) => s.trim()));
  const has = new Set(after.map((s) => s.trim()));
  return { added: after.filter((s) => !had.has(s.trim())), removed: before.filter((s) => !has.has(s.trim())) };
}

export function changedFields(before: BuildMilestone, after: BuildMilestone): MilestoneField[] {
  return MILESTONE_FIELDS.filter((f) => before[f].trim() !== after[f].trim());
}

/**
 * Pair each milestone of `after` with one of `before`: the same title at the same place,
 * then the same title anywhere (a moved milestone), then what is at the same place if it
 * kept any field (a renamed one; a milestone that kept nothing is another milestone).
 * Returns `pairs[j]` = the index in `before`, or -1 for an added milestone.
 */
function pairMilestones(before: readonly BuildMilestone[], after: readonly BuildMilestone[]): number[] {
  const pairs = after.map(() => -1);
  const used = new Set<number>();
  const take = (j: number, i: number) => {
    pairs[j] = i;
    used.add(i);
  };
  after.forEach((m, j) => {
    const there = before[j];
    if (there && norm(there.title) === norm(m.title)) take(j, j);
  });
  after.forEach((m, j) => {
    if (pairs[j] !== -1) return;
    const i = before.findIndex((b, k) => !used.has(k) && norm(b.title) === norm(m.title));
    if (i >= 0) take(j, i);
  });
  after.forEach((m, j) => {
    const there = before[j];
    if (pairs[j] === -1 && there && !used.has(j) && changedFields(there, m).length < MILESTONE_FIELDS.length) take(j, j);
  });
  return pairs;
}

export function diffMilestones(before: readonly BuildMilestone[], after: readonly BuildMilestone[]): MilestoneDiff[] {
  const pairs = pairMilestones(before, after);
  const entries: { diff: MilestoneDiff; from: number }[] = after.map((m, j) => {
    const i = pairs[j] ?? -1;
    const old = before[i];
    if (!old) return { diff: { kind: 'added', after: m }, from: -1 };
    const fields = changedFields(old, m);
    return { diff: fields.length ? { kind: 'changed', before: old, after: m, fields } : { kind: 'same', before: old, after: m }, from: i };
  });
  const paired = new Set(pairs);
  before.forEach((m, i) => {
    if (paired.has(i)) return;
    // After the entry that holds the closest earlier milestone of `before` (or first).
    let at = 0;
    entries.forEach((e, k) => {
      if (e.from !== -1 && e.from < i) at = k + 1;
    });
    while (entries[at]?.diff.kind === 'removed' && (entries[at]?.from ?? i) < i) at += 1;
    entries.splice(at, 0, { diff: { kind: 'removed', before: m }, from: i });
  });
  return entries.map((e) => e.diff);
}

/** What changed from `before` (an older version) to `after` (usually the current plan). */
export function diffPlans(before: BuildPlan, after: BuildPlan): PlanDiff {
  const summary = { changed: before.summary.trim() !== after.summary.trim(), before: before.summary, after: after.summary };
  const stack = diffList(before.stack, after.stack);
  const milestones = diffMilestones(before.milestones, after.milestones);
  const outOfScope = diffList(before.out_of_scope, after.out_of_scope);
  const changed =
    summary.changed ||
    stack.added.length + stack.removed.length + outOfScope.added.length + outOfScope.removed.length > 0 ||
    milestones.some((m) => m.kind !== 'same');
  return { summary, stack, milestones, outOfScope, changed };
}

/** "Changed: commit, done when". */
export const changedLine = (fields: readonly MilestoneField[]): string => `Changed: ${fields.map((f) => FIELD_LABELS[f]).join(', ')}`;

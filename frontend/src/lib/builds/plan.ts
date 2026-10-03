/**
 * Editing a build's plan by hand (`PUT /builds/{id}/plan`), and reading preflight fixes.
 * Pure helpers: the components keep the state, these say how it changes.
 */
import type { BuildMilestone, BuildPlan, PreflightCheck } from '../api/types/builds';

export const MILESTONES = { min: 3, max: 12 } as const;

/** Each milestone field's longest length (backend `Milestone`). */
export const MILESTONE_MAX = { title: 80, commit: 100, deliverable: 500, done_when: 300 } as const;

export const blankMilestone = (): BuildMilestone => ({ title: '', commit: '', deliverable: '', done_when: '' });

/** Move the item at `index` one place up (-1) or down (+1); out of range leaves the list. */
export function move<T>(items: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || index >= items.length || to < 0 || to >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item as T);
  return next;
}

export const replaceAt = <T>(items: readonly T[], index: number, item: T): T[] => items.map((x, i) => (i === index ? item : x));

export const removeAt = <T>(items: readonly T[], index: number): T[] => items.filter((_, i) => i !== index);

/** What keeps an edited plan from being saved, or null. */
export function milestonesProblem(milestones: readonly BuildMilestone[]): string | null {
  if (milestones.length < MILESTONES.min || milestones.length > MILESTONES.max) {
    return `A plan has ${MILESTONES.min} to ${MILESTONES.max} milestones.`;
  }
  const empty = milestones.findIndex((m) => !m.title.trim() || !m.commit.trim() || !m.deliverable.trim() || !m.done_when.trim());
  return empty >= 0 ? `Milestone ${empty + 1} needs every field: title, commit message, deliverable and done when.` : null;
}

/** The plan with these milestones, each field trimmed. */
export function withMilestones(plan: BuildPlan, milestones: readonly BuildMilestone[]): BuildPlan {
  return {
    ...plan,
    milestones: milestones.map((m) => ({
      title: m.title.trim(),
      commit: m.commit.trim(),
      deliverable: m.deliverable.trim(),
      done_when: m.done_when.trim(),
    })),
  };
}

/** Words a fix starts with when it is a command to run as it stands. */
const COMMANDS = /^(gh|git|uv|pnpm|npm|npx|pip|brew|claude|python3?|node|cargo|docker|export|cd)\b/;

/**
 * A preflight fix split into prose and the commands in it: `code spans` are commands, and
 * a fix that is itself a command is one.
 */
export function fixParts(fix: string | null): { text: string; commands: string[] } {
  if (!fix) return { text: '', commands: [] };
  const spans = [...fix.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
  if (spans.length) return { text: fix.replace(/`([^`]+)`/g, '$1'), commands: spans };
  const trimmed = fix.trim();
  return COMMANDS.test(trimmed) ? { text: '', commands: [trimmed] } : { text: trimmed, commands: [] };
}

/** The checks worth showing: every failing one, errors first. */
export function failingChecks(checks: readonly PreflightCheck[]): PreflightCheck[] {
  const failing = checks.filter((c) => !c.ok);
  return [...failing.filter((c) => c.level === 'error'), ...failing.filter((c) => c.level === 'warning')];
}

/** True when a failing error blocks the build (the server's `ready`, recomputed). */
export const blocks = (checks: readonly PreflightCheck[]) => checks.some((c) => !c.ok && c.level === 'error');

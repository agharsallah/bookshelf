/**
 * The new-build form as data: its starting values (your settings, then a preset on top),
 * the checks the backend makes too (docs/BUILDS.md §3), and the request body it sends.
 */
import type { BuildAdvanced, BuildCreate, BuildDefaults, BuildOptions, BuildPreset, BuildReference, BuildStops, BuildVisibility, ContextSectionKey } from '../api/types/builds';
import { advancedBaseline, advancedDefaultsOf, advancedOut, validateAdvanced, type AdvancedField } from './advanced';
import { CONTEXT_LIMITS, contextOptions, referencesOut, validateReferences } from './context';

/** The backend's limits, mirrored so the form can say what is wrong before sending. */
export const LIMITS = {
  goal: { min: 10, max: 4000 },
  repoName: { max: 100, pattern: /^[A-Za-z0-9._-]{1,100}$/ },
  owner: { max: 39, pattern: /^[A-Za-z0-9-]{1,39}$/ },
  minutes: { min: 5, max: 720 },
  commits: { min: 1, max: 200 },
  budget: { min: 0.5, max: 200 },
  doneWhen: { count: 10, length: 300 },
} as const;

/** Used when the settings cannot be read. */
export const FALLBACK_DEFAULTS: BuildDefaults = {
  owner: null,
  visibility: 'private',
  claude_attribution: false,
  link_paper: true,
  max_minutes: 90,
  max_commits: 30,
  max_budget_usd: null,
  advanced: advancedDefaultsOf(undefined),
};

export const VISIBILITY_OPTIONS: readonly { value: BuildVisibility; label: string }[] = [
  { value: 'private', label: 'Private' },
  { value: 'public', label: 'Public' },
  { value: 'local', label: 'Local only' },
];

export const GOAL_EXAMPLES = [
  'a minimal PyTorch transformer for learning, least code possible',
  'an interactive website explaining how it works',
] as const;

export interface BuildDraft {
  /** The preset chosen, or null for "something else". */
  preset: string | null;
  goal: string;
  stack: string;
  doneWhen: string[];
  maxMinutes: number;
  maxCommits: number;
  /** null: no budget cap. */
  maxBudget: number | null;
  /** Blank: let the planner suggest one. */
  repoName: string;
  visibility: BuildVisibility;
  owner: string | null;
  claudeAttribution: boolean;
  linkPaper: boolean;
  allowWeb: boolean;
  /** Paper-brief sections switched off (none: all go in). */
  sectionsOff: ContextSectionKey[];
  /** → `docs/NOTES.md`; blank: no notes. */
  notes: string;
  references: BuildReference[];
  advanced: BuildAdvanced;
}

/** A repository name out of a paper's title: `attention-is-all-you-need`. */
export function suggestRepoName(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = slug.slice(0, 48).replace(/-+$/, '');
  return cut || 'paper-build';
}

/** The form before any preset: your settings' defaults and a suggested repo name. */
export function initialDraft(defaults: BuildDefaults, repoName: string): BuildDraft {
  return {
    preset: null,
    goal: '',
    stack: '',
    doneWhen: [],
    maxMinutes: defaults.max_minutes,
    maxCommits: defaults.max_commits,
    maxBudget: defaults.max_budget_usd,
    repoName,
    visibility: defaults.visibility,
    owner: defaults.owner,
    claudeAttribution: defaults.claude_attribution,
    linkPaper: defaults.link_paper,
    allowWeb: false,
    sectionsOff: [],
    notes: '',
    references: [],
    advanced: advancedBaseline(defaults.advanced),
  };
}

/**
 * Choose a preset: its goal, stack and stops fill the form (a stop the preset leaves out
 * keeps your default). Repo options stay as they are. `null` clears back to the defaults.
 */
export function applyPreset(draft: BuildDraft, preset: BuildPreset | null, defaults: BuildDefaults): BuildDraft {
  if (!preset) {
    return { ...draft, preset: null, goal: '', stack: '', doneWhen: [], maxMinutes: defaults.max_minutes, maxCommits: defaults.max_commits, maxBudget: defaults.max_budget_usd };
  }
  const stops = preset.stops;
  return {
    ...draft,
    preset: preset.key,
    goal: preset.goal,
    stack: preset.stack ?? '',
    doneWhen: [...(stops.done_when ?? [])],
    maxMinutes: stops.max_minutes ?? defaults.max_minutes,
    maxCommits: stops.max_commits ?? defaults.max_commits,
    maxBudget: stops.max_budget_usd ?? defaults.max_budget_usd,
  };
}

export type DraftField = 'goal' | 'repoName' | 'maxMinutes' | 'maxCommits' | 'maxBudget' | 'doneWhen' | 'notes' | 'references' | AdvancedField;
export type DraftErrors = Partial<Record<DraftField, string>>;

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;

/** Every *done when* line that says something, trimmed. */
export const doneWhenLines = (lines: readonly string[]) => lines.map((l) => l.trim()).filter(Boolean);

export function validateRepoName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return LIMITS.repoName.pattern.test(trimmed) ? null : 'Letters, digits, dots, dashes and underscores only (up to 100).';
}

/** A GitHub org or user name, or blank for the signed-in account. */
export function validateOwner(owner: string): string | null {
  const trimmed = owner.trim();
  if (!trimmed) return null;
  return LIMITS.owner.pattern.test(trimmed) ? null : 'A GitHub name: letters, digits and dashes (up to 39).';
}

/** An extra goal for Continue: optional, else as long as a goal must be. */
export function validateExtraGoal(goal: string): string | null {
  const n = goal.trim().length;
  if (n === 0) return null;
  if (n < LIMITS.goal.min) return `Say a little more: at least ${LIMITS.goal.min} characters, or leave it empty.`;
  return n > LIMITS.goal.max ? `At most ${LIMITS.goal.max} characters.` : null;
}

export function validateStops(stops: Pick<BuildDraft, 'maxMinutes' | 'maxCommits' | 'maxBudget' | 'doneWhen'>): DraftErrors {
  const errors: DraftErrors = {};
  if (!Number.isInteger(stops.maxMinutes) || !inRange(stops.maxMinutes, LIMITS.minutes.min, LIMITS.minutes.max)) {
    errors.maxMinutes = `Between ${LIMITS.minutes.min} and ${LIMITS.minutes.max} minutes.`;
  }
  if (!Number.isInteger(stops.maxCommits) || !inRange(stops.maxCommits, LIMITS.commits.min, LIMITS.commits.max)) {
    errors.maxCommits = `Between ${LIMITS.commits.min} and ${LIMITS.commits.max} commits.`;
  }
  if (stops.maxBudget !== null && !inRange(stops.maxBudget, LIMITS.budget.min, LIMITS.budget.max)) {
    errors.maxBudget = `Between $${LIMITS.budget.min} and $${LIMITS.budget.max}, or leave it empty for no cap.`;
  }
  const lines = doneWhenLines(stops.doneWhen);
  if (lines.length > LIMITS.doneWhen.count) errors.doneWhen = `At most ${LIMITS.doneWhen.count} lines.`;
  else if (lines.some((l) => l.length > LIMITS.doneWhen.length)) errors.doneWhen = `Each line at most ${LIMITS.doneWhen.length} characters.`;
  return errors;
}

export function validateDraft(draft: BuildDraft): DraftErrors {
  const errors = validateStops(draft);
  const goal = draft.goal.trim().length;
  if (goal < LIMITS.goal.min) errors.goal = `Say a little more: at least ${LIMITS.goal.min} characters.`;
  else if (goal > LIMITS.goal.max) errors.goal = `At most ${LIMITS.goal.max} characters.`;
  const repo = validateRepoName(draft.repoName);
  if (repo) errors.repoName = repo;
  if (draft.notes.length > CONTEXT_LIMITS.notes) errors.notes = `At most ${CONTEXT_LIMITS.notes} characters.`;
  const references = validateReferences(draft.references);
  if (references) errors.references = references;
  return { ...errors, ...validateAdvanced(draft.advanced) };
}

export function stopsOf(draft: Pick<BuildDraft, 'maxMinutes' | 'maxCommits' | 'maxBudget' | 'doneWhen'>): BuildStops {
  return {
    max_minutes: draft.maxMinutes,
    max_commits: draft.maxCommits,
    max_budget_usd: draft.maxBudget,
    done_when: doneWhenLines(draft.doneWhen),
  };
}

/**
 * `POST /papers/{ref}/builds`. A blank repo name goes as `""`: the planner suggests one
 * (`plan.repo_name`) and the approval step sends the name you settle on.
 */
export function createBody(draft: BuildDraft): BuildCreate {
  return { goal: draft.goal.trim(), preset: draft.preset, options: optionsOf(draft), stops: stopsOf(draft) };
}

/** The options as sent, on create and to render the context preview (the full advanced object, explicitly). */
export function optionsOf(draft: BuildDraft): BuildOptions {
  return {
    repo_name: draft.repoName.trim(),
    visibility: draft.visibility,
    owner: draft.owner?.trim() || null,
    claude_attribution: draft.claudeAttribution,
    link_paper: draft.linkPaper,
    stack: draft.stack.trim() || null,
    allow_web: draft.allowWeb,
    context: contextOptions(draft.sectionsOff, draft.notes),
    references: referencesOut(draft.references),
    advanced: advancedOut(draft.advanced, draft.visibility),
  };
}

/** A number input's value, or null when empty (an optional budget). */
export function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

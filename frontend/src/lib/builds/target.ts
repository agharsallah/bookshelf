/**
 * Where a build lands (docs/BUILDS.md §7c) as form data: a new repository, a folder of a
 * GitHub repository, or a folder of a repository on this machine. Its starting values and
 * suggestions, the checks the backend makes too, which repository options still apply,
 * and the `options.target` it sends.
 */
import type { BuildAdvanced, BuildDelivery, BuildTarget, BuildTargetKind, BuildVisibility, ConfineMode, TargetInspection } from '../api/types/builds';
import { blocks } from './plan';

export interface TargetDraft {
  kind: BuildTargetKind;
  /** github: `owner/name`, set by picking one. */
  repo: string;
  /** local: the path as typed. */
  path: string;
  /** Blank: the repository's default (github) or current (local) branch. */
  baseBranch: string;
  folder: string;
  /** Blank: `build/<folder slug>`. */
  branch: string;
  useRepoInstructions: boolean;
  confine: ConfineMode;
  /** local: also push the branch to `origin`. */
  pushBranch: boolean;
  /** github: a pull request (the default), or straight onto the base branch. */
  delivery: BuildDelivery;
}

export const KIND_CARDS: readonly { value: BuildTargetKind; label: string; hint: string }[] = [
  { value: 'new', label: 'New repository', hint: 'A repository of its own, on GitHub or on this computer.' },
  { value: 'github', label: 'A GitHub repository', hint: 'A folder of one you can push to, delivered on a branch.' },
  { value: 'local', label: 'A repository on this machine', hint: 'A folder of a git repository on disk, on a branch of its own.' },
];

export const CONFINE_OPTIONS: readonly { value: ConfineMode; label: string }[] = [
  { value: 'warn', label: 'Warn' },
  { value: 'stop', label: 'Stop the run' },
];

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

/** Where a build goes in an existing repository unless you say otherwise. */
export const suggestFolder = (paperSlug: string) => `papers/${paperSlug || 'paper'}`;

/** `papers/attention/` → `papers/attention`: trimmed, no trailing slash. */
export const normalizeFolder = (folder: string) => folder.trim().replace(/\/+$/, '');

/** The branch the build works on when you leave it blank: `build/<folder slug>`. */
export function suggestBranch(folder: string): string {
  const last = normalizeFolder(folder).split('/').pop() ?? '';
  return `build/${slug(last) || 'paper'}`;
}

/** A new repository, with the folder an existing one would get already suggested. */
export const defaultTarget = (paperSlug: string): TargetDraft => ({
  kind: 'new',
  repo: '',
  path: '',
  baseBranch: '',
  folder: suggestFolder(paperSlug),
  branch: '',
  useRepoInstructions: true,
  confine: 'warn',
  pushBranch: false,
  delivery: 'pull_request',
});

export const isExisting = (kind: BuildTargetKind) => kind !== 'new';

/* ── Checks (mirroring the backend's) ─────────────────────────────────────────── */

export const TARGET_LIMITS = { repo: /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/ } as const;

export function validateRepo(repo: string): string | null {
  const trimmed = repo.trim();
  if (!trimmed) return 'Pick a repository.';
  return TARGET_LIMITS.repo.test(trimmed) ? null : 'A GitHub repository as owner/name.';
}

export function validateLocalPath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return 'The path to a git repository on this machine.';
  if (trimmed.startsWith('~')) return 'Spell out your home folder: ~ is not expanded here.';
  return trimmed.startsWith('/') ? null : 'An absolute path, from the root: /Users/you/code/project.';
}

export function validateFolder(folder: string): string | null {
  const trimmed = normalizeFolder(folder);
  if (!trimmed) return 'Name the folder the build goes in.';
  if (trimmed.startsWith('/')) return 'A folder inside the repository: no leading /.';
  if (trimmed.includes('\\')) return 'Use / between folder names.';
  const parts = trimmed.split('/');
  if (parts.includes('..')) return 'Stay inside the repository: no .. in the folder.';
  if (parts.some((p) => p === '' || p === '.')) return 'Each part of the folder needs a name (no //, no .).';
  return parts[0] === '.git' ? 'Not inside .git.' : null;
}

const controlChar = (s: string) => [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/** git's rules for a ref name (`git check-ref-format`), each with what to say when broken. */
const REF_RULES: readonly [(b: string) => boolean, string][] = [
  [(b) => /\s/.test(b) || controlChar(b), 'no spaces'],
  [(b) => /[~^:?*[\\]/.test(b), 'none of ~ ^ : ? * [ \\'],
  [(b) => b.includes('..'), 'no ..'],
  [(b) => b.includes('@{') || b === '@', 'no @{'],
  [(b) => b.startsWith('/') || b.endsWith('/') || b.includes('//'), 'no leading, trailing or double /'],
  [(b) => b.startsWith('-'), 'not starting with -'],
  [(b) => b.endsWith('.') || b.endsWith('.lock'), 'not ending with . or .lock'],
  [(b) => b.split('/').some((p) => p.startsWith('.')), 'no part starting with a dot'],
];

/** Why git would refuse this branch name, or null. Blank is fine (the default applies). */
export function validateBranch(name: string): string | null {
  const b = name.trim();
  if (!b) return null;
  const broken = REF_RULES.find(([breaks]) => breaks(b));
  return broken ? `Not a branch name git takes: ${broken[1]}.` : null;
}

export type TargetField = 'targetRepo' | 'targetPath' | 'targetFolder' | 'targetBase' | 'targetBranch';
export type TargetErrors = Partial<Record<TargetField, string>>;

export function validateTarget(t: TargetDraft): TargetErrors {
  if (t.kind === 'new') return {};
  const errors: TargetErrors = {};
  const where = t.kind === 'github' ? validateRepo(t.repo) : validateLocalPath(t.path);
  if (where) errors[t.kind === 'github' ? 'targetRepo' : 'targetPath'] = where;
  const folder = validateFolder(t.folder);
  if (folder) errors.targetFolder = folder;
  const base = validateBranch(t.baseBranch);
  if (base) errors.targetBase = base;
  const branch = validateBranch(t.branch);
  if (branch) errors.targetBranch = branch;
  return errors;
}

/* ── What applies, and what is sent ───────────────────────────────────────────── */

/** The repository options the form shows. An existing repository keeps its own name, owner, visibility, license, description and topics. */
export interface RepoFields {
  name: boolean;
  visibility: boolean;
  license: boolean;
  description: boolean;
  topics: boolean;
  /** The Advanced delivery choice (an existing GitHub repo chooses it under Where). */
  delivery: boolean;
  /** Push cadence: whenever something is pushed (for a local repo, only with *push the branch*). */
  push: boolean;
}

export function repoFieldsFor(kind: BuildTargetKind, pushBranch = false): RepoFields {
  const fresh = kind === 'new';
  return { name: fresh, visibility: fresh, license: fresh, description: fresh, topics: fresh, delivery: fresh, push: kind !== 'local' || pushBranch };
}

export interface DeliveryChoice {
  value: BuildDelivery;
  label: string;
  hint: string;
  /** Worth a second thought. */
  warn: boolean;
}

/** An existing GitHub repository's delivery: a pull request into the base, or (if you insist) the base itself. */
export function deliveryChoices(base: string): DeliveryChoice[] {
  return [
    { value: 'pull_request', label: 'Pull request', hint: `Works on its own branch and opens a pull request into ${base} at the end, for you to review.`, warn: false },
    { value: 'push_main', label: `Push to ${base}`, hint: `Commits land straight on ${base}, with no review before they do. Only for a repository that is yours alone.`, warn: true },
  ];
}

/** The visibility sent with a target: GitHub's checks for a GitHub repository, none for a local one. */
export function visibilityFor(kind: BuildTargetKind, visibility: BuildVisibility): BuildVisibility {
  if (kind === 'local') return 'local';
  if (kind === 'github' && visibility === 'local') return 'private';
  return visibility;
}

/** Advanced options as they apply to the target: an existing repository's delivery comes from Where; its license, description and topics stay its own. */
export function advancedFor(t: Pick<TargetDraft, 'kind' | 'delivery'>, advanced: BuildAdvanced): BuildAdvanced {
  if (t.kind === 'new') return advanced;
  return { ...advanced, license: 'none', description: null, topics: [], delivery: t.kind === 'github' ? t.delivery : 'push_main' };
}

/** `options.target`, or undefined for a new repository (the field is left out). */
export function targetOut(t: TargetDraft): BuildTarget | undefined {
  if (t.kind === 'new') return undefined;
  return {
    kind: t.kind,
    repo: t.kind === 'github' ? t.repo.trim() : null,
    path: t.kind === 'local' ? t.path.trim() : null,
    base_branch: t.baseBranch.trim() || null,
    folder: normalizeFolder(t.folder) || null,
    branch: t.branch.trim() || null,
    use_repo_instructions: t.useRepoInstructions,
    confine: t.confine,
    push_branch: t.kind === 'local' && t.pushBranch,
  };
}

/* ── The inspection, as the form reads it ─────────────────────────────────────── */

export type FolderState = 'free' | 'empty' | 'taken';

export function folderState(inspection: Pick<TargetInspection, 'folder_exists' | 'folder_empty'>): FolderState {
  if (!inspection.folder_exists) return 'free';
  return inspection.folder_empty ? 'empty' : 'taken';
}

export function folderHint(folder: string, state: FolderState): string {
  const f = normalizeFolder(folder);
  if (state === 'free') return `${f} is free: the build creates it.`;
  if (state === 'empty') return `${f} exists and is empty: the build fills it.`;
  return `${f} already exists and is not empty. Pick another folder: a build never writes over what is there.`;
}

/**
 * Why the submit waits on the target, or null: an existing repository needs an inspection
 * of the form as it stands, with no failing error and a folder that is free or empty.
 */
export function targetHold(kind: BuildTargetKind, inspection: TargetInspection | null, folder: string): string | null {
  if (kind === 'new') return null;
  if (!inspection) return kind === 'github' ? 'Pick a repository first.' : 'Check the repository first.';
  if (folderState(inspection) === 'taken') return folderHint(folder, 'taken');
  return blocks(inspection.problems) ? 'Fix what the repository check found first.' : null;
}

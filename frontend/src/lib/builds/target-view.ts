/**
 * A build's target (docs/BUILDS.md §7c) as the UI tells it: where it went in a line, the
 * approve step's summary, the local branch to switch to once it ends, and the repository
 * tree folded to two levels with the build's folder marked where it goes.
 */
import type { BuildOptions, BuildState, BuildTarget } from '../api/types/builds';
import { isActive } from './state';
import { normalizeFolder, suggestBranch } from './target';

/** The target of a build into an existing repository; null for a new one. */
export const existingTarget = (options: Pick<BuildOptions, 'target'>): BuildTarget | null =>
  options.target && options.target.kind !== 'new' ? options.target : null;

/** `/Users/you/code/foo` → `~/code/foo`, for reading (never sent). */
export const shortPath = (path: string) => path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');

/** The branch the build works on: as asked, else `build/<folder slug>`. */
export const branchOf = (t: BuildTarget) => t.branch ?? suggestBranch(t.folder ?? '');

const folderOf = (t: BuildTarget) => normalizeFolder(t.folder ?? '') || '…';

/** `owner/foo` or `~/code/foo (local)`. */
export const whereOf = (t: BuildTarget) => (t.kind === 'github' ? (t.repo ?? '…') : `${shortPath(t.path ?? '…')} (local)`);

/** A list row's line: `owner/foo · papers/attention`. */
export function targetLabel(options: Pick<BuildOptions, 'target'>): string | null {
  const t = existingTarget(options);
  if (!t) return null;
  return `${t.kind === 'github' ? (t.repo ?? '…') : shortPath(t.path ?? '…')} · ${folderOf(t)}`;
}

/**
 * The approve step's restatement:
 * `Into owner/foo · papers/attention on build/attention → pull request into main`, or
 * `Into ~/code/foo (local) · papers/attention on build/attention · stays local`.
 */
export function targetSummary(options: Pick<BuildOptions, 'target' | 'advanced'>): string | null {
  const t = existingTarget(options);
  if (!t) return null;
  const head = `Into ${whereOf(t)} · ${folderOf(t)} on ${branchOf(t)}`;
  if (t.kind === 'local') return `${head} · ${t.push_branch ? 'pushed to origin' : 'stays local'}`;
  const base = t.base_branch ?? 'the default branch';
  return `${head} → ${options.advanced.delivery === 'push_main' ? `pushed straight to ${base}` : `pull request into ${base}`}`;
}

export interface LocalBranchNote {
  branch: string;
  path: string;
  command: string;
}

/** Once a local build's run has ended: the branch its work is on, and how to get there. */
export function localBranchNote(build: { state: BuildState; options: Pick<BuildOptions, 'target'> }): LocalBranchNote | null {
  const t = existingTarget(build.options);
  if (!t || t.kind !== 'local' || isActive(build.state) || build.state === 'planned') return null;
  const branch = branchOf(t);
  return { branch, path: shortPath(t.path ?? ''), command: `git switch ${branch}` };
}

/* ── The repository tree, folded ──────────────────────────────────────────────── */

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  /** Second-level entries (top-level nodes only). */
  children: TreeNode[];
  /** `target`: the build's folder; `contains`: the folder is somewhere inside. */
  mark: 'target' | 'contains' | null;
  /** Not in the repository yet: where the folder would go. */
  ghost: boolean;
}

const node = (name: string, path: string, dir: boolean): TreeNode => ({ name, path, dir, children: [], mark: null, ghost: false });

const byKind = (a: TreeNode, b: TreeNode) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name);

/** The node named `name` in `list`, added as a ghost directory when missing. */
function ensure(list: TreeNode[], name: string, path: string): TreeNode {
  const found = list.find((n) => n.name === name);
  if (found) return found;
  const ghost = { ...node(name, path, true), ghost: true };
  list.push(ghost);
  return ghost;
}

/**
 * The survey's tree (paths to depth 2; a trailing `/` or a child marks a directory) as
 * top-level nodes, each with its children, directories first. The folder is marked on the
 * way down, and added as a ghost where it does not exist yet.
 */
export function repoTree(entries: readonly string[], folder: string): TreeNode[] {
  const top: TreeNode[] = [];
  for (const raw of entries) {
    const isDir = raw.endsWith('/');
    const parts = raw.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const [first, second] = parts;
    if (!first) continue;
    let parent = top.find((n) => n.name === first);
    if (!parent) {
      parent = node(first, first, isDir || parts.length > 1);
      top.push(parent);
    }
    if (parts.length > 1) parent.dir = true;
    if (!second) continue;
    const childDir = isDir || parts.length > 2;
    const child = parent.children.find((n) => n.name === second);
    if (child) child.dir ||= childDir;
    else parent.children.push(node(second, `${first}/${second}`, childDir));
  }
  const parts = normalizeFolder(folder).split('/').filter(Boolean);
  const [first, second] = parts;
  if (first) {
    const a = ensure(top, first, first);
    a.mark = parts.length === 1 ? 'target' : 'contains';
    if (second) ensure(a.children, second, `${first}/${second}`).mark = parts.length === 2 ? 'target' : 'contains';
  }
  for (const n of top) n.children.sort(byKind);
  return top.sort(byKind);
}

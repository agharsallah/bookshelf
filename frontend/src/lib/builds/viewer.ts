/**
 * A `BuildContextView` as the viewer's tabs: one per file, the repository survey (a build
 * into an existing repository, §7c), then the kickoff, the agent brief, the allowed tools,
 * the command and (when there is one) the planner's input.
 */
import type { BuildContextView } from '../api/types/builds';
import { wordsOf } from './context';

export interface ViewerTab {
  key: string;
  label: string;
  /** `tools` shows as a list; the rest as text. */
  kind: 'text' | 'tools';
  /** What Copy puts on the clipboard. */
  text: string;
  words: number;
}

/** `docs/PAPER.md` → `PAPER.md`, `docs/references/01-x.md` → `references/01-x.md`. */
export const fileLabel = (path: string) => path.replace(/^docs\//, '');

/** One shell word: quoted when it holds anything a shell would split or expand. */
export const shellWord = (arg: string) => (/^[A-Za-z0-9_./:=@%+,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);

/** The argv as a command you could paste, one flag per line. */
export function shellJoin(argv: readonly string[]): string {
  const lines: string[] = [];
  for (const arg of argv.map(shellWord)) {
    if (arg.startsWith('-') || lines.length === 0) lines.push(arg);
    else lines[lines.length - 1] += ` ${arg}`;
  }
  return lines.join(' \\\n  ');
}

/** `Bash(make:*)` for an extra command `make`: the tools you added yourself. */
export const isExtraTool = (tool: string, extras: readonly string[]) => extras.some((cmd) => tool === `Bash(${cmd}:*)`);

export function viewerTabs(view: BuildContextView): ViewerTab[] {
  const text = (key: string, label: string, body: string): ViewerTab => ({ key, label, kind: 'text', text: body, words: wordsOf(body) });
  const tabs: ViewerTab[] = view.files.map((f) => ({ key: `file:${f.path}`, label: fileLabel(f.path), kind: 'text', text: f.content, words: f.words }));
  // The survey's one place in the viewer: `survey_md` is its wire name (to reconcile with the backend).
  if (view.survey_md) tabs.push(text('repository', 'Repository', view.survey_md));
  tabs.push(text('kickoff', 'Kickoff', view.kickoff), text('brief', 'Agent brief', view.agent_brief));
  tabs.push({ key: 'tools', label: 'Allowed tools', kind: 'tools', text: view.allowed_tools.join('\n'), words: view.allowed_tools.length });
  tabs.push(text('command', 'Command', shellJoin(view.command)));
  if (view.plan_input) tabs.push(text('plan', 'Planner input', JSON.stringify(view.plan_input, null, 2)));
  return tabs;
}

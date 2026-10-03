/**
 * A build's state as the UI tells it (docs/BUILDS.md §2): which phase it is in, what to
 * call it, whether it is still moving (and so polled), and how far it is against each limit.
 */
import type { BuildState, BuildStops, BuildSummary, StopReason } from '../api/types/builds';

/** What the studio shows for a build: its plan being made, the plan to review, or the run. */
export type BuildPhase = 'plan' | 'review' | 'run';

export function phaseOf(state: BuildState): BuildPhase {
  if (state === 'planning') return 'plan';
  if (state === 'planned') return 'review';
  return 'run';
}

/** Still moving on the server: the UI polls it. */
export function isActive(state: BuildState): boolean {
  return state === 'planning' || state === 'building' || state === 'stopping';
}

/** Running an agent (Stop applies; Delete does not). */
export function isRunning(state: BuildState): boolean {
  return state === 'building' || state === 'stopping';
}

/** Finished in a way that `continue` can pick up. */
export function canContinue(state: BuildState): boolean {
  return state === 'done' || state === 'stopped';
}

export function canDelete(state: BuildState): boolean {
  return !isRunning(state);
}

export const STATE_LABELS: Record<BuildState, string> = {
  planning: 'Planning',
  planned: 'Plan ready',
  building: 'Building',
  stopping: 'Stopping',
  done: 'Done',
  stopped: 'Stopped',
  failed: 'Failed',
};

/** The badge's tone: `busy` pulses, `good` / `bad` are colored, `wait` asks for you. */
export type StateTone = 'busy' | 'wait' | 'good' | 'quiet' | 'bad';

export const STATE_TONES: Record<BuildState, StateTone> = {
  planning: 'busy',
  planned: 'wait',
  building: 'busy',
  stopping: 'busy',
  done: 'good',
  stopped: 'quiet',
  failed: 'bad',
};

export const STOP_REASON_LABELS: Record<StopReason, string> = {
  goal_reached: 'the goal was reached',
  max_minutes: 'the time limit was reached',
  max_commits: 'the commit limit was reached',
  max_budget: 'the budget ran out',
  user: 'you stopped it',
  agent_gave_up: 'the agent gave up',
  error: 'an error ended it',
};

export interface LimitMeter {
  key: 'time' | 'commits' | 'budget';
  label: string;
  value: number;
  max: number;
  /** 0..1, clamped. */
  fraction: number;
  /** "12 of 90 min". */
  text: string;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Progress against each limit; the budget only when there is a cap. */
export function limitMeters(build: Pick<BuildSummary, 'elapsed_seconds' | 'commits' | 'cost_usd' | 'stops'>): LimitMeter[] {
  const { stops } = build;
  const minutes = Math.floor((build.elapsed_seconds ?? 0) / 60);
  const commits = build.commits.length;
  const meters: LimitMeter[] = [
    {
      key: 'time',
      label: 'Time',
      value: minutes,
      max: stops.max_minutes,
      fraction: clamp01(minutes / stops.max_minutes),
      text: `${minutes} of ${stops.max_minutes} min`,
    },
    {
      key: 'commits',
      label: 'Commits',
      value: commits,
      max: stops.max_commits,
      fraction: clamp01(commits / stops.max_commits),
      text: `${commits} of ${stops.max_commits}`,
    },
  ];
  if (stops.max_budget_usd !== null) {
    const cost = build.cost_usd ?? 0;
    meters.push({
      key: 'budget',
      label: 'Budget',
      value: cost,
      max: stops.max_budget_usd,
      fraction: clamp01(cost / stops.max_budget_usd),
      text: `${usd(cost)} of ${usd(stops.max_budget_usd)}`,
    });
  }
  return meters;
}

/** A commit's page on GitHub, or null for a local build (no remote). */
export function commitUrl(repoUrl: string | null, sha: string): string | null {
  if (!repoUrl) return null;
  return `${repoUrl.replace(/\/+$/, '')}/commit/${sha}`;
}

export const shortSha = (sha: string) => sha.slice(0, 7);

/** "owner/name" out of `https://github.com/owner/name`, else the URL as given. */
export function repoLabel(repoUrl: string): string {
  const match = /github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(repoUrl);
  return match?.[1] ?? repoUrl;
}

export function stopsLine(stops: BuildStops): string {
  const parts = [`${stops.max_minutes} min`, `${stops.max_commits} commits`];
  parts.push(stops.max_budget_usd === null ? 'no budget cap' : `${usd(stops.max_budget_usd)} budget`);
  return parts.join(' · ');
}

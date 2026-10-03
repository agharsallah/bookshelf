/**
 * Settings → Database logic that needs no DOM: what each database holds in a line, which
 * one changed last, what stops a switch or a sync, and how a sync is going, in words.
 */
import type { DatabaseCounts, DatabaseStatus, DatabaseTarget, DatabaseTargetPublic, SyncProgress } from '../../lib/api/types/database';
import { relativeTime } from '../review/labels';

export const other = (target: DatabaseTarget): DatabaseTarget => (target === 'local' ? 'remote' : 'local');

export function targetOf(status: DatabaseStatus, target: DatabaseTarget): DatabaseTargetPublic | undefined {
  return status.targets.find((t) => t.target === target);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** `42 documents · 310 notes · 187 study items · 5 collections`. */
export function countsLine(counts: DatabaseCounts): string {
  return [
    plural(counts.documents, 'document'),
    plural(counts.notes, 'note'),
    plural(counts.artifacts, 'study item'),
    plural(counts.collections, 'collection'),
  ].join(' · ');
}

export function lastChangeLine(counts: DatabaseCounts, now: number = Date.now()): string {
  return counts.last_change ? `Last change ${relativeTime(counts.last_change, now)}` : 'Nothing written yet';
}

const changedAt = (t: DatabaseTargetPublic | undefined) => (t?.counts?.last_change ? Date.parse(t.counts.last_change) : null);

/** The database written to most recently, when both say and they differ. */
export function newer(status: DatabaseStatus): DatabaseTarget | null {
  const local = changedAt(targetOf(status, 'local'));
  const remote = changedAt(targetOf(status, 'remote'));
  if (local === null || remote === null || local === remote) return null;
  return local > remote ? 'local' : 'remote';
}

function unusable(t: DatabaseTargetPublic | undefined): string | null {
  if (!t) return 'It is not configured.';
  if (!t.reachable) return `${t.label} cannot be reached${t.error ? `: ${t.error}` : '.'}`;
  return null;
}

/** Why the app cannot move to `target` now, or null when it can. */
export function switchBlocker(status: DatabaseStatus, target: DatabaseTarget): string | null {
  if (!status.available) return 'Only one database is configured.';
  if (status.sync.state === 'running') return 'A sync is running.';
  if (status.schema_problems.length) return 'The two databases have different schemas.';
  return unusable(targetOf(status, target));
}

/** Why `source` cannot be copied over the other database now, or null when it can. */
export function syncBlocker(status: DatabaseStatus, source: DatabaseTarget): string | null {
  if (!status.available) return 'Only one database is configured.';
  if (status.sync.state === 'running') return 'A sync is running.';
  if (status.schema_problems.length) return 'The two databases have different schemas.';
  for (const t of [targetOf(status, source), targetOf(status, other(source))]) {
    const reason = unusable(t);
    if (reason) return reason;
    const running = t?.counts?.running_jobs ?? 0;
    if (running) return `${plural(running, 'job is', 'jobs are')} running on ${t?.label}. Sync once they finish.`;
  }
  return null;
}

/** The warning a sync's confirmation leads with when it would throw newer work away. */
export function overwriteWarning(status: DatabaseStatus, source: DatabaseTarget): string | null {
  if (newer(status) !== other(source)) return null;
  const dest = targetOf(status, other(source));
  const from = targetOf(status, source);
  return `${dest?.label} changed more recently than ${from?.label}. Whatever is only there will be lost.`;
}

/** 0–1 for a progress bar; null while there is nothing to measure yet (checks, backup). */
export function progressShare(sync: SyncProgress): number | null {
  if (sync.state !== 'running' || sync.tables_total === 0) return null;
  return sync.tables_done / sync.tables_total;
}

const named = (status: DatabaseStatus, target: DatabaseTarget | null) =>
  (target && targetOf(status, target)?.label) ?? (target === 'local' ? 'This computer' : 'the main database');

/** One line for the sync as it is: running, finished or failed; empty when idle. */
export function syncLine(status: DatabaseStatus): string {
  const { sync } = status;
  const route = `${named(status, sync.source)} → ${named(status, sync.dest)}`;
  switch (sync.state) {
    case 'running':
      return sync.tables_total
        ? `${route}: ${sync.step} (${sync.tables_done + 1} of ${sync.tables_total} tables)`
        : `${route}: ${sync.step}…`;
    case 'done':
      return `Synced ${route}: ${plural(sync.rows, 'row')} copied.`;
    case 'failed':
      return `The sync ${route} failed: ${sync.error ?? 'unknown error'}. ${named(status, sync.dest)} was left as it was.`;
    default:
      return '';
  }
}

/** The verb a sync button says, from the local side's point of view. */
export function syncVerb(source: DatabaseTarget, labelOf: (t: DatabaseTarget) => string): string {
  return source === 'local' ? `Upload to ${labelOf('remote')}` : `Download to ${labelOf('local').toLowerCase()}`;
}

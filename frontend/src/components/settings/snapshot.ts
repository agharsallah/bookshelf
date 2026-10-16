/**
 * Settings → Database → Snapshot logic that needs no DOM: the last snapshot in a line, how
 * one being made or restored is going, and what stops a restore of a picked file.
 */
import type { SnapshotFile, SnapshotProgress, SnapshotStatus } from '../../lib/api/types/snapshots';
import { formatSize } from '../library/ingest';
import { relativeTime } from '../review/labels';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

/** `Made 2 hours ago · 412.3 MB · 42 documents, 1,830 files`. */
export function latestLine(file: SnapshotFile, now: number = Date.now()): string {
  return `Made ${relativeTime(file.created_at, now)} · ${formatSize(file.size_bytes)} · ${plural(file.documents, 'document')}, ${plural(file.files, 'file')}`;
}

/** 0–1 for a progress bar; null while there is nothing to count yet. */
export function progressShare(progress: SnapshotProgress): number | null {
  if (progress.state !== 'running' || progress.total === 0) return null;
  return Math.min(progress.done / progress.total, 1);
}

/** One line for the snapshot being made or restored, or the last one's outcome; empty when idle. */
export function progressLine(progress: SnapshotProgress, database: string): string {
  const making = progress.action === 'export';
  const error = (progress.error ?? 'unknown error').replace(/\.$/, '');
  switch (progress.state) {
    case 'running':
      return progress.total ? `${progress.step} (${progress.done} of ${progress.total.toLocaleString('en')})` : `${progress.step}…`;
    case 'done':
      return making
        ? 'Snapshot ready to download.'
        : `Restored ${plural(progress.rows, 'row')} into ${database}. Search is being rebuilt in the queue.`;
    case 'failed':
      return making
        ? `The snapshot failed: ${error}.`
        : `The restore failed: ${error}. If it failed before the rows were replaced, ${database} and its files are as they were.`;
    default:
      return '';
  }
}

/** Why a restore of `file` cannot start, or null when it can. */
export function restoreBlocker(status: SnapshotStatus, file: Pick<File, 'name' | 'size'>): string | null {
  if (status.progress.state === 'running') return 'A snapshot is being made or restored.';
  if (!file.name.endsWith('.tar.gz')) return 'Pick a snapshot: a .tar.gz file made by Bookshelf.';
  if (file.size > status.max_bytes) return `That file is larger than the ${formatSize(status.max_bytes)} a restore accepts.`;
  return null;
}

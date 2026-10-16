/**
 * Settings → Database → Snapshot (`/database/snapshot`): the whole shelf — every row, the
 * originals in `library/`, the figures and the audio — as one file. Make one and download
 * it here; restore it on another install (or back here) to have the same state there.
 * Making and restoring run on the server; this polls them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { SnapshotProgress, SnapshotStatus } from '../../lib/api/types/snapshots';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { Section } from './Controls';
import styles from './Database.module.css';
import { RestoreDialog } from './RestoreDialog';
import { latestLine, progressLine, progressShare, restoreBlocker } from './snapshot';

export interface SnapshotSectionProps {
  api?: Pick<ApiClient, 'get' | 'post' | 'url'>;
  /** How often a snapshot being made or restored is polled. */
  pollMs?: number;
}

type Busy = 'export' | 'upload' | null;

export function SnapshotSection({ api = browserApi, pollMs = 1000 }: SnapshotSectionProps) {
  const [status, setStatus] = useState<SnapshotStatus | null>(null);
  const [loadProblem, setLoadProblem] = useState<ProblemInfo | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ title: string; info: ProblemInfo } | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      api.get<SnapshotStatus>('database/snapshot').then(
        (next) => {
          setStatus(next);
          setLoadProblem(null);
        },
        (error: unknown) => setLoadProblem(problemOf(error)),
      ),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const running = status?.progress.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void load(), pollMs);
    return () => clearTimeout(timer);
  }, [running, status, load, pollMs]);

  if (loadProblem && !status) return <Problem title="Snapshots could not be checked." problem={loadProblem} />;

  const started = (progress: SnapshotProgress) => setStatus((s) => (s ? { ...s, progress } : s));

  const make = async () => {
    setBusy('export');
    setProblem(null);
    try {
      started(await api.post<SnapshotProgress>('database/snapshot'));
    } catch (error) {
      setProblem({ title: 'The snapshot did not start.', info: problemOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const pick = (file: File | undefined) => {
    if (input.current) input.current.value = ''; // the same file can be picked again
    if (!file || !status) return;
    const blocked = restoreBlocker(status, file);
    setProblem(blocked ? { title: 'That file cannot be restored.', info: problemOf(new Error(blocked)) } : null);
    if (!blocked) setPicked(file);
  };

  const restore = async (backup: boolean) => {
    if (!picked) return;
    setBusy('upload');
    setProblem(null);
    try {
      started(await api.post<SnapshotProgress>('database/snapshot/restore', picked, { query: { backup } }));
    } catch (error) {
      setProblem({ title: 'The restore did not start.', info: problemOf(error) });
    } finally {
      setPicked(null);
      setBusy(null);
    }
  };

  const progress = status?.progress;
  const share = progress ? progressShare(progress) : null;
  const line = status && progress ? progressLine(progress, status.database) : '';
  const blocked = busy !== null || running;

  return (
    <Section
      id="snapshot"
      eyebrow="Storage"
      title="Snapshot"
      hint="Everything in one file: the database, the originals in library/, the figures and the audio. Download one here and restore it on another computer to have the same library there. Search is rebuilt after a restore."
    >
      {status === null ? (
        <p className={styles.muted} role="status">
          Checking for a snapshot…
        </p>
      ) : (
        <>
          <p className={styles.muted}>
            {status.latest ? `${latestLine(status.latest)}.` : 'No snapshot made here yet.'} A snapshot is of {status.database}, the database in use.
          </p>
          <div className={styles.syncBar}>
            <button type="button" className={styles.secondary} disabled={blocked} onClick={() => void make()}>
              {busy === 'export' ? 'Starting…' : status.latest ? 'Make a new snapshot' : 'Make a snapshot'}
            </button>
            {status.latest ? (
              // A form post, so the browser saves the file itself; the proxy adds the key to posts.
              <form method="post" action={api.url('database/snapshot/download')}>
                <button type="submit" className={styles.primary} disabled={running}>
                  <span aria-hidden="true">↓</span> Download
                </button>
              </form>
            ) : null}
            <button type="button" className={styles.secondary} disabled={blocked} onClick={() => input.current?.click()}>
              <span aria-hidden="true">↑</span> Restore a snapshot…
            </button>
            <input
              ref={input}
              type="file"
              accept=".tar.gz,.gz,application/gzip"
              hidden
              aria-label="Snapshot file"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>

          {running ? (
            <div className={styles.progress}>
              <progress max={1} value={share ?? undefined} aria-label="Snapshot progress" />
            </div>
          ) : null}
          {progress?.state === 'failed' ? (
            <p className={styles.warning} role="alert">
              {line}
            </p>
          ) : (
            <p className={styles.status} role="status">
              {[
                line,
                progress?.state === 'done' && progress.backup_path ? `Database backup: ${progress.backup_path}.` : '',
                progress?.state === 'done' && progress.kept_path ? `Replaced folders: ${progress.kept_path}.` : '',
              ]
                .filter(Boolean)
                .join(' ')}
            </p>
          )}
          {problem ? <Problem inline title={problem.title} problem={problem.info} /> : null}

          <RestoreDialog status={status} file={picked} busy={busy === 'upload'} onConfirm={(backup) => void restore(backup)} onClose={() => setPicked(null)} />
        </>
      )}
    </Section>
  );
}

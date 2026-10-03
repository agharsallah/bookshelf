/**
 * Settings → Database (`/database`): the two databases side by side — this computer's and
 * the main (Supabase) one — as a choice of which the app reads and writes, plus upload and
 * download buttons that copy one over the other. A sync runs on the server; this polls it.
 */
import { useCallback, useEffect, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { DatabaseStatus, DatabaseTarget, DatabaseTargetPublic, SyncProgress } from '../../lib/api/types/database';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { Section } from './Controls';
import {
  countsLine,
  lastChangeLine,
  newer,
  progressShare,
  switchBlocker,
  syncBlocker,
  syncLine,
  syncVerb,
  targetOf,
} from './database';
import styles from './Database.module.css';
import { SyncDialog } from './SyncDialog';

export interface DatabaseSectionProps {
  api?: Pick<ApiClient, 'get' | 'put' | 'post'>;
  /** How often a running sync is polled. */
  pollMs?: number;
}

type Busy = 'switch' | 'sync' | null;

function Card({ target, newest, blocked, onPick }: { target: DatabaseTargetPublic; newest: boolean; blocked: string | null; onPick: () => void }) {
  const { counts } = target;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={target.active}
      className={styles.card}
      disabled={!target.active && blocked !== null}
      title={!target.active && blocked ? blocked : undefined}
      onClick={target.active ? undefined : onPick}
    >
      <span className={styles.cardHead}>
        <span className={target.reachable ? styles.dotOk : styles.dotDown} aria-hidden="true" />
        <strong>{target.label}</strong>
        {target.active ? <span className={styles.badge}>In use</span> : null}
        {newest ? <span className={styles.badgeQuiet}>Newer</span> : null}
      </span>
      <code className={styles.host}>{target.host}</code>
      {!target.reachable ? (
        <span className={styles.down}>Cannot be reached{target.error ? `: ${target.error}` : ''}</span>
      ) : counts ? (
        <>
          <span>{countsLine(counts)}</span>
          <span className={styles.muted}>{lastChangeLine(counts)}</span>
        </>
      ) : target.pending_migrations ? (
        <span className={styles.muted}>
          {target.pending_migrations} schema update{target.pending_migrations === 1 ? '' : 's'} to apply; done on the first switch or sync.
        </span>
      ) : null}
      {!target.active && target.reachable ? <span className={styles.pick}>Read and write here</span> : null}
    </button>
  );
}

export function DatabaseSection({ api = browserApi, pollMs = 1000 }: DatabaseSectionProps) {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [loadProblem, setLoadProblem] = useState<ProblemInfo | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [problem, setProblem] = useState<{ title: string; info: ProblemInfo } | null>(null);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState<DatabaseTarget | null>(null);

  const load = useCallback(
    () =>
      api.get<DatabaseStatus>('database').then(
        (next) => {
          setStatus(next);
          setLoadProblem(null);
          return next;
        },
        (error: unknown) => {
          setLoadProblem(problemOf(error));
          return null;
        },
      ),
    [api],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // While a sync runs, ask again until it ends; the final answer carries the new counts.
  const running = status?.sync.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void load(), pollMs);
    return () => clearTimeout(timer);
  }, [running, status, load, pollMs]);

  if (loadProblem && !status) return <Problem title="The databases could not be checked." problem={loadProblem} />;

  const labelOf = (t: DatabaseTarget) => (status && targetOf(status, t)?.label) ?? t;

  const pick = async (target: DatabaseTarget) => {
    if (!status) return;
    const leaving = targetOf(status, status.active);
    setBusy('switch');
    setProblem(null);
    setNotice(`Switching to ${labelOf(target)}…`);
    try {
      setStatus(await api.put<DatabaseStatus>('database/active', { target }));
      const handedBack = leaving?.counts?.running_jobs ?? 0;
      setNotice(
        `Now reading and writing ${labelOf(target)}.` +
          (handedBack ? ` ${handedBack} running job${handedBack === 1 ? '' : 's'} went back to the queue on ${leaving?.label}.` : ''),
      );
    } catch (error) {
      setNotice('');
      setProblem({ title: `Still using ${leaving?.label}.`, info: problemOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const sync = async (backup: boolean) => {
    if (!confirming || !status) return;
    setBusy('sync');
    setProblem(null);
    setNotice('');
    try {
      const progress = await api.post<SyncProgress>('database/sync', { source: confirming, backup });
      setStatus({ ...status, sync: progress });
      setConfirming(null);
    } catch (error) {
      setConfirming(null);
      setProblem({ title: 'The sync did not start.', info: problemOf(error) });
    } finally {
      setBusy(null);
    }
  };

  const local = status && targetOf(status, 'local');
  const remote = status && targetOf(status, 'remote');
  const newest = status ? newer(status) : null;
  const share = status ? progressShare(status.sync) : null;
  const line = status ? syncLine(status) : '';

  return (
    <Section
      id="database"
      eyebrow="Storage"
      title="Database"
      hint="Where your library is read and written: the database on this computer or the main one. Upload or download copies one over the other."
    >
      {status === null ? (
        <p className={styles.muted} role="status">
          Checking both databases…
        </p>
      ) : !status.available ? (
        <p className={styles.note}>
          Only one database is configured ({targetOf(status, status.active)?.host}). Set <code>BOOKSHELF_LOCAL_DATABASE_URL</code> and{' '}
          <code>BOOKSHELF_DATABASE_URL</code> to two different databases to switch and sync between them.
        </p>
      ) : (
        <>
          <div className={styles.cards} role="radiogroup" aria-label="Read and write">
            {[local, remote].map((t) =>
              t ? (
                <Card
                  key={t.target}
                  target={t}
                  newest={newest === t.target}
                  blocked={busy ? 'Busy.' : switchBlocker(status, t.target)}
                  onPick={() => void pick(t.target)}
                />
              ) : null,
            )}
          </div>

          {status.schema_problems.length ? (
            <div className={styles.warning} role="alert">
              <p>The two databases have different schemas, so they cannot be switched or synced. Apply the migrations to both first:</p>
              <ul>
                {status.schema_problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={styles.syncBar}>
            {(['local', 'remote'] as const).map((source) => {
              const blocked = busy ? 'Busy.' : syncBlocker(status, source);
              return (
                <button
                  key={source}
                  type="button"
                  className={styles.secondary}
                  disabled={blocked !== null}
                  title={blocked ?? undefined}
                  onClick={() => setConfirming(source)}
                >
                  <span aria-hidden="true">{source === 'local' ? '↑' : '↓'}</span> {syncVerb(source, labelOf)}
                </button>
              );
            })}
            {!running && syncBlocker(status, 'local') && syncBlocker(status, 'local') === syncBlocker(status, 'remote') ? (
              <span className={styles.muted}>{syncBlocker(status, 'local')}</span>
            ) : null}
          </div>

          {running ? (
            <div className={styles.progress}>
              <progress max={1} value={share ?? undefined} aria-label="Sync progress" />
            </div>
          ) : null}
          {status.sync.state === 'failed' ? (
            <p className={styles.warning} role="alert">
              {line}
            </p>
          ) : null}
          <p className={styles.status} role="status">
            {status.sync.state === 'failed' ? notice : [line, status.sync.state === 'done' && status.sync.backup_path ? `Backup: ${status.sync.backup_path}` : '', notice].filter(Boolean).join(' ')}
          </p>
          {problem ? <Problem inline title={problem.title} problem={problem.info} /> : null}

          <SyncDialog status={status} source={confirming} busy={busy === 'sync'} onConfirm={(backup) => void sync(backup)} onClose={() => setConfirming(null)} />
        </>
      )}
    </Section>
  );
}

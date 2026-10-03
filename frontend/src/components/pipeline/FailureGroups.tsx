/**
 * Failed jobs, one entry per cause (./failures.ts): how many it hit, the kinds, documents
 * and anchors, when it last happened, the error once (its full text behind a
 * disclosure, with each job and its own Retry), and "Retry all N", which retries the
 * group's jobs a few at a time and says how it went. Jobs of a paused document are left
 * out: resuming the document requeues them.
 */
import { useState } from 'react';
import type { JobPublic } from '../../lib/api/types/jobs';
import { retryJob } from '../../lib/jobs/api';
import { problemOf } from '../common/Problem';
import { relativeTime } from '../review/labels';
import { compactAnchors, runAll, type FailureGroup } from './failures';
import { FailedRow, type JobApi } from './JobRows';
import { KIND_LABELS } from './model';
import styles from './FailureGroups.module.css';

export interface FailureGroupsProps {
  groups: readonly FailureGroup[];
  now: number;
  api: JobApi;
  onChanged: (job: JobPublic) => void;
  title: (job: JobPublic) => string;
  isPaused: (job: JobPublic) => boolean;
}

type Run =
  | { state: 'idle' }
  | { state: 'running'; settled: number; total: number }
  | { state: 'finished'; queued: number; already: number; refused: number; reason: string | null };

const SLOT = /(‹anchor›|‹id›|\{…\}|\[…\]|‘…’|\bN\b)/;

/** The signature with its placeholders set quietly apart from the words. */
function Signature({ text }: { text: string }) {
  return (
    <>
      {text.split(SLOT).map((part, i) =>
        SLOT.test(part) ? (
          <span key={i} className={styles.slot}>
            {part.replace(/[‹›]/g, '')}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

function outcome(run: Extract<Run, { state: 'finished' }>, single: boolean): string {
  if (single && run.refused === 0) return run.already ? 'Already queued.' : 'Queued again.';
  const parts = [run.queued && `${run.queued} queued again`, run.already && `${run.already} already queued`].filter(Boolean);
  const done = parts.length ? `${parts.join(', ')}.` : '';
  const refused = run.refused ? ` ${run.refused} not queued${run.reason ? `: ${run.reason}` : '.'}` : '';
  return `${done}${refused}`.trim();
}

type GroupProps = Omit<FailureGroupsProps, 'groups'> & { group: FailureGroup };

function Group({ group, now, api, onChanged, title, isPaused }: GroupProps) {
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [retried, setRetried] = useState<ReadonlySet<string>>(new Set());
  const retryable = group.jobs.filter((j) => !isPaused(j) && !retried.has(j.id));
  const pausedCount = group.jobs.filter(isPaused).length;
  const single = group.jobs.length === 1;
  const [newest] = group.jobs as [JobPublic];
  const docs = [...new Set(group.jobs.map(title))];
  const anchors = compactAnchors(group.anchors);

  const retryAll = async () => {
    const targets = retryable;
    setRun({ state: 'running', settled: 0, total: targets.length });
    const result = await runAll(targets, (job) => retryJob(api, job.id), {
      onSettled: (settled, total) => setRun({ state: 'running', settled, total }),
    });
    result.done.forEach(({ value }) => onChanged(value.job));
    setRetried((was) => new Set([...was, ...result.done.map(({ item }) => item.id)]));
    const [firstRefusal] = result.failed;
    setRun({
      state: 'finished',
      queued: result.done.filter(({ value }) => !value.deduplicated).length,
      already: result.done.filter(({ value }) => value.deduplicated).length,
      refused: result.failed.length,
      reason: firstRefusal ? problemOf(firstRefusal.error).message : null,
    });
  };

  const label = single ? 'Retry' : `Retry all ${retryable.length}`;
  return (
    <li className={styles.group}>
      <p className={styles.count} aria-label={`${group.jobs.length} failed ${single ? 'job' : 'jobs'}`}>
        {group.jobs.length}
      </p>
      <div className={styles.body}>
        <p className={styles.signature}>
          <Signature text={group.signature} />
        </p>
        <p className={styles.meta}>
          {group.kinds.map((kind) => (
            <span key={kind} className={styles.kind}>
              {KIND_LABELS[kind]}
            </span>
          ))}
          <span className={styles.where}>
            <span className={styles.docs}>{docs.join(', ')}</span>
            {anchors ? <span className={styles.anchors}>at {anchors}</span> : null}
          </span>
          <span className={styles.when}>{single ? relativeTime(group.latest, now) : `latest ${relativeTime(group.latest, now)}`}</span>
        </p>
        <details className={styles.more}>
          <summary>{single ? 'Show the full error' : `Show the full error and all ${group.jobs.length} jobs`}</summary>
          <pre className={styles.error}>{newest.error ?? 'No error message was recorded.'}</pre>
          {single ? null : (
            <ul className={styles.jobs}>
              {group.jobs.map((job) => (
                <FailedRow key={job.id} job={job} title={title(job)} now={now} api={api} onChanged={onChanged} paused={isPaused(job)} retried={retried.has(job.id)} compact />
              ))}
            </ul>
          )}
        </details>
      </div>
      <div className={styles.actions}>
        {retryable.length > 0 || run.state !== 'idle' ? (
          <button type="button" className="btn" onClick={() => void retryAll()} disabled={run.state === 'running' || retryable.length === 0}>
            {run.state === 'running' ? `Retrying ${run.settled} of ${run.total}…` : retryable.length === 0 ? 'Queued again' : label}
          </button>
        ) : null}
        {pausedCount > 0 ? (
          <span className={styles.note}>
            {pausedCount === group.jobs.length ? 'Its document is paused; resuming requeues it.' : `${pausedCount} wait for a paused document to resume.`}
          </span>
        ) : null}
        <span aria-live="polite" className={run.state === 'finished' && run.refused ? styles.refused : styles.note}>
          {run.state === 'finished' ? outcome(run, single) : null}
        </span>
      </div>
    </li>
  );
}

export function FailureGroups({ groups, ...rest }: FailureGroupsProps) {
  if (groups.length === 0) return <p className={styles.empty}>No failures.</p>;
  return (
    <ol className={styles.groups}>
      {groups.map((group) => (
        <Group key={group.signature} group={group} {...rest} />
      ))}
    </ol>
  );
}

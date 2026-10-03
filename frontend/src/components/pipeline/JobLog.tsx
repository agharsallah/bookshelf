/**
 * A job's log, closed by default: its timeline (queued, waiting out a retry, started,
 * finished, attempts), every model call it made over all attempts (`GET /jobs/{id}/runs`:
 * model, tokens, cost, time, turns, and the error of a failed call), what it was asked
 * for and what it returned. The calls load when the log is first opened, and again when
 * the job moves on (a new attempt, a new state) while it stays open.
 */
import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { JobPublic, ModelRunPublic } from '../../lib/api/types/jobs';
import { loadJobRuns } from '../../lib/jobs/api';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { formatCount, formatDuration, formatUsd } from '../stats/format';
import { placeInLine } from '../../lib/jobs/progress';
import styles from './JobLog.module.css';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' });
const stamp = (iso: string | null | undefined) => (iso ? when.format(new Date(iso)) : null);

type Runs = { state: 'loading' } | { state: 'loaded'; runs: ModelRunPublic[] } | { state: 'error'; problem: ProblemInfo };

export interface JobLogProps {
  job: JobPublic;
  api: Pick<ApiClient, 'get'>;
}

export function JobLog({ job, api }: JobLogProps) {
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.log} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary aria-label={`Log of job ${job.id}`}>Log</summary>
      {open ? <LogBody job={job} api={api} /> : null}
    </details>
  );
}

function LogBody({ job, api }: JobLogProps) {
  const [runs, setRuns] = useState<Runs>({ state: 'loading' });
  const moment = `${job.state}:${job.attempts}`;

  useEffect(() => {
    let current = true;
    loadJobRuns(api, job.id).then(
      (loaded) => current && setRuns({ state: 'loaded', runs: loaded }),
      (error: unknown) => current && setRuns({ state: 'error', problem: problemOf(error) }),
    );
    return () => {
      current = false;
    };
  }, [api, job.id, moment]);

  return (
    <div className={styles.body}>
      <Timeline job={job} />
      <section aria-label="Model calls">
        <h3 className={styles.heading}>Model calls</h3>
        {runs.state === 'loading' ? <p className={styles.muted}>Loading the calls…</p> : null}
        {runs.state === 'error' ? <Problem title="The calls could not be loaded." problem={runs.problem} inline /> : null}
        {runs.state === 'loaded' ? <Calls runs={runs.runs} job={job} /> : null}
      </section>
      <Json label="Asked for" value={job.payload} />
      <Json label="Returned" value={job.result} />
      {job.error ? (
        <section aria-label="Error">
          <h3 className={styles.heading}>Error</h3>
          <pre className={styles.pre}>{job.error}</pre>
        </section>
      ) : null}
    </div>
  );
}

function Timeline({ job }: { job: JobPublic }) {
  const waits = job.state === 'queued' && job.run_after && Date.parse(job.run_after) > Date.now() ? job.run_after : null;
  const rows: [string, string | null][] = [
    ['Queued', stamp(job.created_at)],
    ['Waits until', stamp(waits)],
    ['Place in line', job.queue_position ? `${placeInLine(job.queue_position)}${job.run_now ? ' (sent to run now)' : ''}` : null],
    ['Started', stamp(job.started_at)],
    ['Finished', stamp(job.finished_at)],
    ['Took', job.duration_ms !== null ? formatDuration(job.duration_ms) : null],
    ['Attempts', job.attempts ? String(job.attempts) : null],
    ['Mode', job.run_mode],
    ['Skill', job.skill ? (job.skill_version ? `${job.skill}@${job.skill_version}` : job.skill) : null],
  ];
  return (
    <dl className={styles.timeline}>
      {rows
        .filter((row): row is [string, string] => row[1] !== null)
        .map(([term, value]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      <div>
        <dt>Job</dt>
        <dd>
          <code>{job.id}</code>
        </dd>
      </div>
    </dl>
  );
}

const sum = (runs: readonly ModelRunPublic[], pick: (r: ModelRunPublic) => number | null) => runs.reduce((total, r) => total + (pick(r) ?? 0), 0);

function Calls({ runs, job }: { runs: readonly ModelRunPublic[]; job: JobPublic }) {
  if (runs.length === 0)
    return <p className={styles.muted}>{job.state === 'queued' ? 'None yet: the job has not run.' : 'None: this work calls no model, or ran before calls were recorded.'}</p>;
  const failed = runs.filter((r) => !r.ok).length;
  const tokens = sum(runs, (r) => (r.input_tokens ?? 0) + (r.output_tokens ?? 0));
  const cost = runs.some((r) => r.cost_usd !== null) ? sum(runs, (r) => r.cost_usd) : null;
  return (
    <>
      <p className={styles.totals}>
        {runs.length} {runs.length === 1 ? 'call' : 'calls'}
        {failed ? <span className={styles.bad}> · {failed} failed</span> : null} · {formatCount(tokens)} tokens · {formatUsd(cost)} ·{' '}
        {formatDuration(sum(runs, (r) => r.duration_ms))}
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">Attempt</th>
              <th scope="col">Model</th>
              <th scope="col">Outcome</th>
              <th scope="col" className={styles.num}>
                In
              </th>
              <th scope="col" className={styles.num}>
                Out
              </th>
              <th scope="col" className={styles.num} title="Tokens read from the prompt cache">
                Cached
              </th>
              <th scope="col" className={styles.num}>
                Cost
              </th>
              <th scope="col" className={styles.num}>
                Time
              </th>
              <th scope="col" className={styles.num}>
                Turns
              </th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <CallRow key={run.id} run={run} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CallRow({ run }: { run: ModelRunPublic }) {
  return (
    <>
      <tr data-ok={run.ok}>
        <td>
          {run.attempt}
          {run.call > 1 ? `.${run.call}` : ''}
          <span className={styles.sub}>{stamp(run.created_at)}</span>
        </td>
        <td>
          {run.model ?? '—'}
          {run.tier ? <span className={styles.sub}>{run.tier}</span> : null}
        </td>
        <td className={run.ok ? undefined : styles.bad}>{run.ok ? 'ok' : 'failed'}</td>
        <td className={styles.num}>{formatCount(run.input_tokens)}</td>
        <td className={styles.num}>{formatCount(run.output_tokens)}</td>
        <td className={styles.num}>{formatCount(run.cache_read_tokens)}</td>
        <td className={styles.num}>{formatUsd(run.cost_usd)}</td>
        <td className={styles.num}>{formatDuration(run.duration_ms)}</td>
        <td className={styles.num}>{run.turns ?? '—'}</td>
      </tr>
      {run.error ? (
        <tr className={styles.errorRow}>
          <td colSpan={9}>
            <pre className={styles.pre}>{run.error}</pre>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Json({ label, value }: { label: string; value: Record<string, unknown> | null | undefined }) {
  if (!value || Object.keys(value).length === 0) return null;
  return (
    <section aria-label={label}>
      <h3 className={styles.heading}>{label}</h3>
      <pre className={styles.pre}>{JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

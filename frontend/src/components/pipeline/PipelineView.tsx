/**
 * The pipeline, live (§7): jobs from `GET /jobs` seeded server-side, then kept current by
 * `/jobs/stream` through the shared `useJobStream` hook. Tallies, per-document stage
 * tracks, running work with elapsed time, failures with retry, and the run ceiling.
 */
import { useMemo, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { JOB_KINDS, JOB_STATES, type JobKind, type JobPublic, type JobState } from '../../lib/api/types/jobs';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { sortedJobs } from '../../lib/jobs/stream';
import type { DocumentLabel } from '../review/api';
import { FailedRow, RecentRow, RunningRow } from './JobRows';
import { countKinds, countStates, filterJobs, isRunCeiling, KIND_LABELS, stageProgress, type JobFilters } from './model';
import { StageTrack } from './StageTrack';
import { useNow } from './useNow';
import styles from './Pipeline.module.css';

export interface PipelineViewProps {
  jobs: JobPublic[];
  documents: DocumentLabel[];
  initialFilters?: JobFilters;
  api?: ApiClient;
  /** Off in tests: no EventSource. */
  live?: boolean;
}

const STREAM_WORDS = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', closed: 'Offline' } as const;
const RECENT = 25;

export function PipelineView({ jobs: seed, documents, initialFilters = {}, api = browserApi, live = true }: PipelineViewProps) {
  const { jobs: byId, status, track } = useJobStream({ seed, enabled: live });
  const [filters, setFilters] = useState<JobFilters>(initialFilters);
  const all = useMemo(() => sortedJobs(byId), [byId]);
  const titles = useMemo(() => Object.fromEntries(documents.map((d) => [d.id, d.title])), [documents]);
  const title = (job: JobPublic) => (job.document_id ? (titles[job.document_id] ?? 'Unknown document') : 'No document');

  const shown = useMemo(() => filterJobs(all, filters), [all, filters]);
  const states = countStates(filterJobs(all, { ...filters, state: '' }));
  const kinds = countKinds(shown);
  const maxKind = Math.max(1, ...Object.values(kinds));
  const running = shown.filter((j) => j.state === 'running' || j.state === 'queued');
  const failed = shown.filter((j) => j.state === 'failed');
  const recent = shown.filter((j) => j.state === 'done' || j.state === 'skipped').slice(0, RECENT);
  const now = useNow(running.some((j) => j.state === 'running'));

  const ceilings = [...new Set(all.filter((j) => j.state === 'failed' && isRunCeiling(j)).map(title))];
  const trackedDocs = documents.filter((d) => !filters.document || d.id === filters.document);

  const toggleState = (state: JobState) => setFilters((f) => ({ ...f, state: f.state === state ? '' : state }));

  return (
    <div className={styles.pipeline}>
      <div className={styles.topline}>
        <p className={styles.stream} data-status={status} aria-live="polite">
          <span className={styles.pulse} aria-hidden="true" />
          {STREAM_WORDS[status]}
        </p>
        <ul className={styles.tallies} aria-label="Jobs by state">
          {JOB_STATES.map((state) => (
            <li key={state}>
              <button type="button" className={styles.tally} data-state={state} aria-pressed={filters.state === state} onClick={() => toggleState(state)}>
                <span className={styles.tallyCount}>{states[state]}</span> {state}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {ceilings.length > 0 ? (
        <div className={styles.ceiling} role="alert">
          <p className={styles.ceilingTitle}>Run ceiling reached</p>
          <p>
            The worker paused {ceilings.join(', ')} after too many skill runs (§14). Review what it produced, then raise{' '}
            <code>BOOKSHELF_MAX_RUNS_PER_DOCUMENT</code> if more runs are warranted.
          </p>
        </div>
      ) : null}

      <form className={styles.filters} aria-label="Filter jobs" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>State</span>
          <select value={filters.state ?? ''} onChange={(e) => setFilters({ ...filters, state: e.target.value as JobState | '' })}>
            <option value="">Any state</option>
            {JOB_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Kind</span>
          <select value={filters.kind ?? ''} onChange={(e) => setFilters({ ...filters, kind: e.target.value as JobKind | '' })}>
            <option value="">Any kind</option>
            {JOB_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Document</span>
          <select value={filters.document ?? ''} onChange={(e) => setFilters({ ...filters, document: e.target.value })}>
            <option value="">Every document</option>
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>
      </form>

      <div className={styles.grid}>
        <section aria-labelledby="docs-title" className={styles.docs}>
          <h2 id="docs-title" className={styles.sectionTitle}>
            Documents
          </h2>
          {trackedDocs.length === 0 ? <p className={styles.muted}>No documents yet. Ingest one from the library.</p> : null}
          <ul className={styles.docList}>
            {trackedDocs.map((doc) => (
              <li key={doc.id} className={styles.doc}>
                <p className={styles.docHead}>
                  <a href={`/documents/${doc.slug}`} className={styles.docTitle}>
                    {doc.title}
                  </a>
                  <span className={styles.docStatus}>{doc.status?.replaceAll('_', ' ')}</span>
                </p>
                <StageTrack label={doc.title} stages={stageProgress(doc.status ?? '', all.filter((j) => j.document_id === doc.id))} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="kinds-title" className={styles.kinds}>
          <h2 id="kinds-title" className={styles.sectionTitle}>
            By kind
          </h2>
          {Object.keys(kinds).length === 0 ? <p className={styles.muted}>No jobs match.</p> : null}
          <dl className={styles.kindList}>
            {JOB_KINDS.filter((k) => kinds[k]).map((k) => (
              <div key={k} className={styles.kindRow}>
                <dt>{KIND_LABELS[k]}</dt>
                <dd>
                  <span className={styles.kindBar} style={{ inlineSize: `${((kinds[k] ?? 0) / maxKind) * 100}%` }} aria-hidden="true" />
                  <span className={styles.num}>{kinds[k]}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section aria-labelledby="running-title">
        <h2 id="running-title" className={styles.sectionTitle}>
          Running and queued <span className={styles.count}>{running.length}</span>
        </h2>
        {running.length === 0 ? <p className={styles.muted}>Nothing is running. The worker picks up queued jobs as they arrive.</p> : null}
        <ul className={styles.jobs}>
          {running.map((job) => (
            <RunningRow key={job.id} job={job} title={title(job)} now={now} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="failed-title">
        <h2 id="failed-title" className={styles.sectionTitle}>
          Failed <span className={styles.count}>{failed.length}</span>
        </h2>
        {failed.length === 0 ? <p className={styles.muted}>No failures.</p> : null}
        <ul className={styles.jobs}>
          {failed.map((job) => (
            <FailedRow key={job.id} job={job} title={title(job)} now={now} api={api} onQueued={track} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title" className={styles.sectionTitle}>
          Recently finished
        </h2>
        {recent.length === 0 ? (
          <p className={styles.muted}>Nothing finished yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col">Scope</th>
                  <th scope="col">State</th>
                  <th scope="col" className={styles.num}>
                    Took
                  </th>
                  <th scope="col" className={styles.num}>
                    Finished
                  </th>
                </tr>
              </thead>
              <tbody>
                {recent.map((job) => (
                  <RecentRow key={job.id} job={job} title={title(job)} now={now} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default PipelineView;

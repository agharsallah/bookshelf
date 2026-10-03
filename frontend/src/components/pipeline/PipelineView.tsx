/**
 * The pipeline, live (§7): jobs from `GET /jobs` seeded server-side, then kept current by
 * `/jobs/stream` through the shared `useJobStream` hook. Tallies by state (which filter),
 * per-document stage bars and jobs by kind, running work with elapsed time (queued jobs
 * can be sent to run now or cancelled), failures grouped by cause with "Retry all",
 * documents the run ceiling paused, with Resume, and queue controls: pause/resume all,
 * and a running cap. Long lists come a page at a time, filters (text included) live in
 * the URL, and every job opens onto its log.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import { JOB_STATES, type JobPublic, type JobState, type QueueStatus } from '../../lib/api/types/jobs';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { sortedJobs } from '../../lib/jobs/stream';
import { PausedNotice } from '../common/PausedNotice';
import type { DocumentLabel } from '../review/api';
import { DocumentsPanel } from './DocumentsPanel';
import { groupFailures } from './failures';
import { FailureGroups } from './FailureGroups';
import { RecentRow, RunningRow } from './JobRows';
import { KindBars } from './KindBars';
import { QueueBanner } from './QueueBanner';
import { QueueControls } from './QueueControls';
import { QueueSteering } from './QueueSteering';
import { useQueueUpdate } from './useQueueUpdate';
import { filterJobs, filtersToSearch, hasFilters, type JobFilters } from './filters';
import { countStates } from './model';
import { PipelineFilters } from './PipelineFilters';
import { ShowMore, useShowMore } from './ShowMore';
import { Bumped, Swatch } from './StateBar';
import { useNow } from './useNow';
import styles from './Pipeline.module.css';

export interface PipelineViewProps {
  jobs: JobPublic[];
  documents: DocumentLabel[];
  /** `GET /jobs/queue` at page load: shown until the stream's first `queue` event. */
  queue?: QueueStatus | null;
  initialFilters?: JobFilters;
  api?: ApiClient;
  /** Off in tests: no EventSource. */
  live?: boolean;
}

const STREAM_WORDS = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…', closed: 'Offline' } as const;
const QUEUED_PAGE = 20;
const RECENT_PAGE = 15;

/** Queued jobs in the order they will start: place in line, then age. */
const byPlace = (a: JobPublic, b: JobPublic) =>
  (a.queue_position ?? Number.POSITIVE_INFINITY) - (b.queue_position ?? Number.POSITIVE_INFINITY) || a.created_at.localeCompare(b.created_at);

/** Keep the filters in the address bar, so a reload or a shared link opens the same view. */
function useFiltersInUrl(filters: JobFilters) {
  useEffect(() => {
    const url = new URL(window.location.href);
    const search = filtersToSearch(filters, url.searchParams).toString();
    if (search === url.searchParams.toString()) return;
    window.history.replaceState(window.history.state, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
  }, [filters]);
}

export function PipelineView({ jobs: seed, documents: initialDocuments, queue: initialQueue = null, initialFilters = {}, api = browserApi, live = true }: PipelineViewProps) {
  const { jobs: byId, status, queue: streamed, track } = useJobStream({ seed, enabled: live });
  // A control change shows at once; the stream's next `queue` event replaces it.
  const [changed, setChanged] = useState<{ over: QueueStatus | null; queue: QueueStatus } | null>(null);
  const latest = streamed ?? initialQueue;
  const queue = changed && changed.over === latest ? changed.queue : latest;
  const onQueue = (next: QueueStatus) => setChanged({ over: latest, queue: next });
  const firstBooks = useQueueUpdate(api, onQueue);
  const [documents, setDocuments] = useState(initialDocuments);
  const [filters, setFilters] = useState<JobFilters>(initialFilters);
  const all = useMemo(() => sortedJobs(byId), [byId]);
  const titles = useMemo(() => Object.fromEntries(documents.map((d) => [d.id, d.title])), [documents]);
  const title = useCallback((job: JobPublic) => (job.document_id ? (titles[job.document_id] ?? 'Unknown document') : 'No document'), [titles]);

  const shown = useMemo(() => filterJobs(all, filters, title), [all, filters, title]);
  const states = countStates(filterJobs(all, { ...filters, state: '' }, title));
  const running = shown.filter((j) => j.state === 'running');
  const queued = useMemo(() => shown.filter((j) => j.state === 'queued').sort(byPlace), [shown]);
  const failed = useMemo(() => shown.filter((j) => j.state === 'failed'), [shown]);
  const causes = useMemo(() => groupFailures(failed), [failed]);
  const finished = shown.filter((j) => j.state === 'done' || j.state === 'skipped');
  const now = useNow(running.length + queued.length > 0);
  const queuedPage = useShowMore(QUEUED_PAGE);
  const recentPage = useShowMore(RECENT_PAGE);
  useFiltersInUrl(filters);

  const paused = documents.filter((d) => d.paused);
  const pausedIds = new Set(paused.map((d) => d.id));
  const resumed = useCallback(
    (id: string, requeued: JobPublic[]) => {
      setDocuments((all) => all.map((d) => (d.id === id ? { ...d, paused: null } : d)));
      requeued.forEach(track);
    },
    [track],
  );

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
                <Swatch state={state} />
                <Bumped value={states[state]} className={styles.tallyCount} /> {state}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {queue ? <QueueControls queue={queue} api={api} onChanged={onQueue} /> : null}
      {queue ? <QueueSteering queue={queue} documents={documents} api={api} onChanged={onQueue} /> : null}

      <QueueBanner queue={queue} />

      {paused.map((doc) =>
        doc.paused ? (
          <PausedNotice key={doc.id} documentRef={doc.slug} paused={doc.paused} title={doc.title} api={api} onResumed={(jobs) => resumed(doc.id, jobs)} />
        ) : null,
      )}

      <PipelineFilters filters={filters} onChange={setFilters} documents={documents} matched={shown.length} total={all.length} />

      <div className={styles.grid}>
        <DocumentsPanel
          documents={documents}
          jobs={all}
          matching={hasFilters(filters) ? shown : null}
          first={queue?.first_documents ?? null}
          onFirst={queue ? (ids) => void firstBooks.send({ first_documents: ids }) : undefined}
        />

        <section aria-labelledby="kinds-title" className={styles.kinds}>
          <h2 id="kinds-title" className={styles.sectionTitle}>
            By kind
          </h2>
          <KindBars jobs={shown} selected={filters.kind || null} onSelect={(kind) => setFilters((f) => ({ ...f, kind: f.kind === kind ? '' : kind }))} />
        </section>
      </div>

      <section aria-labelledby="running-title">
        <h2 id="running-title" className={styles.sectionTitle}>
          Running <span className={styles.count}>{running.length}</span>
        </h2>
        {running.length === 0 ? (
          <p className={styles.muted}>{queued.length ? 'Nothing is running right now.' : 'Nothing is running. The worker picks up queued jobs as they arrive.'}</p>
        ) : null}
        <ul className={styles.jobs}>
          {running.map((job) => (
            <RunningRow key={job.id} job={job} title={title(job)} now={now} queue={queue} api={api} onChanged={track} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="queued-title">
        <h2 id="queued-title" className={styles.sectionTitle}>
          Queued <span className={styles.count}>{queued.length}</span>
          {queued.length ? <span className={styles.subCount}>in the order they start</span> : null}
        </h2>
        {queued.length === 0 ? <p className={styles.muted}>Nothing is waiting.</p> : null}
        <ul className={styles.jobs}>
          {queued.slice(0, queuedPage.limit).map((job) => (
            <RunningRow key={job.id} job={job} title={title(job)} now={now} queue={queue} api={api} onChanged={track} />
          ))}
        </ul>
        <ShowMore shown={Math.min(queuedPage.limit, queued.length)} total={queued.length} step={QUEUED_PAGE} noun="queued jobs" onMore={queuedPage.more} onAll={queuedPage.all} />
      </section>

      <section aria-labelledby="failed-title">
        <h2 id="failed-title" className={styles.sectionTitle}>
          Failed <span className={styles.count}>{failed.length}</span>
          {causes.length > 1 ? <span className={styles.subCount}>from {causes.length} causes</span> : null}
        </h2>
        <FailureGroups
          groups={causes}
          now={now}
          api={api}
          onChanged={track}
          title={title}
          isPaused={(job) => job.document_id !== null && pausedIds.has(job.document_id)}
        />
      </section>

      <section aria-labelledby="recent-title">
        <h2 id="recent-title" className={styles.sectionTitle}>
          Recently finished <span className={styles.count}>{finished.length}</span>
        </h2>
        {finished.length === 0 ? <p className={styles.muted}>Nothing finished yet.</p> : null}
        <ul className={styles.jobs}>
          {finished.slice(0, recentPage.limit).map((job) => (
            <RecentRow key={job.id} job={job} title={title(job)} now={now} api={api} />
          ))}
        </ul>
        <ShowMore shown={Math.min(recentPage.limit, finished.length)} total={finished.length} step={RECENT_PAGE} noun="finished jobs" onMore={recentPage.more} onAll={recentPage.all} />
      </section>
    </div>
  );
}

export default PipelineView;

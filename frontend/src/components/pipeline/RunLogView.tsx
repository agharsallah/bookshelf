/**
 * The run log inside a job's log panel (./JobLog.tsx): what happened, as it happened.
 * While the job runs it follows it, asking `GET /jobs/{id}/log` for what came since every
 * `POLL_MS`, and keeps the newest line in view unless the reader scrolled up to read. When
 * the job moves on (a new attempt, a new state) it reads once more for the last lines.
 * The prompt each call sent stays folded; the reply the skill returned shows in full.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { JobPublic, RunLogEvent } from '../../lib/api/types/jobs';
import { loadJobLog } from '../../lib/jobs/api';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { formatCount } from '../stats/format';
import { logEntries, type LogEntry } from './runLog';
import styles from './RunLogView.module.css';

export const POLL_MS = 1500;
const time = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium' });

type Api = Pick<ApiClient, 'get'>;

/** The job's log events, read in full once, then followed while `live`. */
export function useRunLog(api: Api, job: Pick<JobPublic, 'id' | 'state' | 'attempts'>, live: boolean) {
  const [events, setEvents] = useState<RunLogEvent[]>([]);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const offset = useRef(0);
  const moment = `${job.state}:${job.attempts}`;

  useEffect(() => {
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const page = await loadJobLog(api, job.id, offset.current);
        if (!current) return;
        offset.current = page.next;
        if (page.events.length) setEvents((was) => [...was, ...page.events]);
        setProblem(null);
      } catch (error) {
        if (current) setProblem(problemOf(error));
      } finally {
        if (current) {
          setLoaded(true);
          if (live) timer = setTimeout(() => void read(), POLL_MS);
        }
      }
    };
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [api, job.id, live, moment]);

  return { events, problem, loaded };
}

export function RunLogView({ job, api }: { job: JobPublic; api: Api }) {
  const live = job.state === 'running';
  const { events, problem, loaded } = useRunLog(api, job, live);
  const entries = logEntries(events);
  const box = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [entries.length, events.length]);

  return (
    <section aria-label="Run log" className={styles.section}>
      <h3 className={styles.heading}>
        Run log {live ? <span className={styles.live}>following live</span> : null}
      </h3>
      {problem ? <Problem title="The run log could not be read." problem={problem} inline /> : null}
      {loaded && entries.length === 0 && !problem ? (
        <p className={styles.muted}>{job.state === 'queued' ? 'Nothing yet: the job has not started.' : 'Nothing recorded: the job ran before run logs were kept, or its log was pruned.'}</p>
      ) : null}
      {entries.length ? (
        <ol
          ref={box}
          className={styles.log}
          aria-live={live ? 'polite' : undefined}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {entries.map((entry) => (
            <Entry key={entry.key} entry={entry} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function Entry({ entry }: { entry: LogEntry }) {
  const at = <time dateTime={entry.at}>{time.format(new Date(entry.at))}</time>;
  switch (entry.kind) {
    case 'line':
      return (
        <li className={styles.line} data-tone={entry.tone}>
          {at}
          <span>
            {entry.text}
            {entry.detail ? <pre className={styles.detail}>{entry.detail}</pre> : null}
          </span>
        </li>
      );
    case 'call':
      return (
        <li className={styles.line} data-tone="call">
          {at}
          <span>
            Call {entry.call} on the {entry.tier} tier
            <details className={styles.fold}>
              <summary>Prompt · {formatCount(entry.promptChars)} characters</summary>
              <pre className={styles.detail}>{entry.prompt}</pre>
            </details>
          </span>
        </li>
      );
    case 'output':
      return (
        <li className={styles.line} data-tone="output">
          {at}
          <span>
            {entry.thinking ? (
              <details className={styles.fold}>
                <summary>Thinking</summary>
                <pre className={styles.detail}>{entry.thinking}</pre>
              </details>
            ) : null}
            {entry.text ? <pre className={styles.stream}>{entry.text}</pre> : null}
          </span>
        </li>
      );
    case 'reply':
      return (
        <li className={styles.line} data-tone={entry.ok ? 'good' : 'bad'}>
          {at}
          <span>
            <details className={styles.fold} open>
              <summary>{entry.summary}</summary>
              <pre className={styles.detail}>{entry.text}</pre>
            </details>
          </span>
        </li>
      );
  }
}

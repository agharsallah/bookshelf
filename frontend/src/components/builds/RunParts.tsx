/** The pieces of a run's page: limit meters, the commits, the event tail, the final report, and where a local build left its work. */
import { useState } from 'react';
import type { BuildCommit, BuildEvent, BuildReport, BuildSummary } from '../../lib/api/types/builds';
import { commitUrl, limitMeters, shortSha } from '../../lib/builds/state';
import type { LocalBranchNote } from '../../lib/builds/target-view';
import { CopyCommand } from '../papers/CopyCommand';
import fields from './Fields.module.css';
import styles from './Run.module.css';
import target from './Target.module.css';

/** Events shown outside workshop mode. */
export const TAIL = 20;

export function LimitMeters({ build }: { build: Pick<BuildSummary, 'elapsed_seconds' | 'commits' | 'cost_usd' | 'stops'> }) {
  return (
    <ul className={styles.meters} aria-label="Limits">
      {limitMeters(build).map((m) => (
        <li key={m.key} className={styles.meter}>
          <span className={styles.meterLabel}>{m.label}</span>
          <div
            role="meter"
            aria-label={m.label}
            aria-valuemin={0}
            aria-valuemax={m.max}
            aria-valuenow={m.value}
            aria-valuetext={m.text}
            className={styles.track}
            data-full={m.fraction >= 1 || undefined}
          >
            <span className={styles.fill} style={{ inlineSize: `${(m.fraction * 100).toFixed(1)}%` }} />
          </div>
          <span className={styles.meterText}>{m.text}</span>
        </li>
      ))}
    </ul>
  );
}

const time = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/** Newest first; each links to its page on GitHub, or shows its sha for a local build. */
export function CommitList({ commits, repoUrl }: { commits: readonly BuildCommit[]; repoUrl: string | null }) {
  if (commits.length === 0) return <p className={fields.hint}>No commits yet.</p>;
  return (
    <ol className={styles.commits} reversed>
      {[...commits].reverse().map((c) => {
        const href = commitUrl(repoUrl, c.sha);
        return (
          <li key={c.sha} className={styles.commitRow}>
            {href ? (
              <a href={href} className={styles.sha} target="_blank" rel="noreferrer">
                {shortSha(c.sha)}
              </a>
            ) : (
              <code className={styles.sha}>{shortSha(c.sha)}</code>
            )}
            <span className={styles.subject}>{c.subject}</span>
            <time className={styles.when} dateTime={c.at}>
              {time(c.at)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

function EventRows({ events }: { events: readonly BuildEvent[] }) {
  return (
    <ol className={styles.events}>
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className={styles.event} data-kind={e.kind}>
          <time dateTime={e.at}>{time(e.at)}</time>
          <span className={styles.eventKind}>{e.kind}</span>
          <span className={styles.eventText}>{e.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** The last few things the agent did; every event kept, in workshop mode. */
export function EventTail({ events }: { events: readonly BuildEvent[] }) {
  const [open, setOpen] = useState(false);
  if (events.length === 0) return null;
  const tail = events.slice(-TAIL);
  return (
    <section aria-labelledby="events-title">
      <h4 id="events-title" className={styles.subhead}>
        What it is doing
      </h4>
      <EventRows events={tail} />
      {events.length > tail.length ? (
        <details className="workshop-only" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className={styles.more}>Every event ({events.length})</summary>
          {open ? <EventRows events={events} /> : null}
        </details>
      ) : null}
    </section>
  );
}

const REPORT_STATUS = { goal_reached: 'Goal reached', partial: 'Partly done', gave_up: 'The agent gave up' } as const;

function Items({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h5 className={styles.subhead}>{title}</h5>
      <ul className={styles.reportList}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function RunReport({ report }: { report: BuildReport }) {
  return (
    <section className={styles.report} aria-labelledby="report-title">
      <h4 id="report-title" className={styles.reportTitle}>
        {REPORT_STATUS[report.status]}
      </h4>
      {report.status === 'goal_reached' ? (
        <>
          <p data-cheer-only="playful" className={styles.cheer}>
            Shipped. A whole repository, from a paper you read.
          </p>
          <p data-cheer-only="quiet" className={styles.cheer}>
            Every milestone landed.
          </p>
        </>
      ) : null}
      <div className={styles.reportGrid}>
        <Items title="Done" items={report.done} />
        <Items title="Not done" items={report.not_done} />
        <Items title="Next steps" items={report.next_steps} />
      </div>
      {report.run_it ? (
        <div>
          <h5 className={styles.subhead}>Run it</h5>
          <pre className={styles.runIt}>
            <code>{report.run_it}</code>
          </pre>
        </div>
      ) : null}
    </section>
  );
}

/** A local build's work is on a branch of your repository (never your checkout): how to get to it. */
export function BranchNote({ note }: { note: LocalBranchNote }) {
  return (
    <section className={target.branchNote} aria-label="Where the work is">
      <p>
        The work is on branch <code>{note.branch}</code> in <code>{note.path}</code>. To look at it there:
      </p>
      <CopyCommand command={note.command} />
    </section>
  );
}

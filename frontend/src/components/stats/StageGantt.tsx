/**
 * The book's end-to-end pass as a Gantt: one row per stage on the pass's own clock, a
 * thin line from its first start to its last finish and solid stretches where its jobs
 * were running. Overlap between rows is the parallelism the stage barriers allowed; a
 * gap is the pipeline waiting (a re-run, a retry backoff, a barrier). Every figure a
 * bar shows is also in its row's text, so the chart is never the only way to read it.
 */
import type { PipelinePass } from '../../lib/api/types/stats';
import { formatCount, formatDuration } from './format';
import { ganttRows, quarterTicks } from './model';
import styles from './StageGantt.module.css';

export function StageGantt({ pass }: { pass: PipelinePass }) {
  const rows = ganttRows(pass);
  if (rows.length === 0) return <p className={styles.empty}>No stage of this pass has finished yet.</p>;
  return (
    <figure className={styles.gantt}>
      <figcaption className="visually-hidden">Stages of the pass over its {formatDuration(pass.wall_ms)} wall clock</figcaption>
      <div className={styles.axis} aria-hidden="true">
        <span />
        <div className={styles.ticks}>
          {quarterTicks(pass.wall_ms).map(([pct, ms]) => (
            <span key={pct} style={{ insetInlineStart: `${pct}%` }} data-edge={pct === 0 ? 'start' : pct === 100 ? 'end' : undefined}>
              {pct === 0 ? '0' : formatDuration(ms)}
            </span>
          ))}
        </div>
        <span />
      </div>
      <ol className={styles.rows}>
        {rows.map((row) => {
          const said = `${row.label}: busy ${formatDuration(row.busyMs)} within ${formatDuration(row.spanMs)} from first start to last finish, ${formatDuration(row.computeMs)} of compute over ${row.jobs} ${row.jobs === 1 ? 'job' : 'jobs'}${row.failed ? `, ${row.failed} failed` : ''}, ${formatCount(row.tokens)} tokens`;
          return (
            <li key={row.kind} className={styles.row} title={said}>
              <span className={styles.label}>{row.label}</span>
              <span className={styles.track}>
                <span className={styles.span} style={{ insetInlineStart: `${row.left}%`, inlineSize: `${row.width}%` }} />
                {row.busy.map((b, i) => (
                  <span key={i} className={styles.bar} style={{ insetInlineStart: `${b.left}%`, inlineSize: `${b.width}%` }} data-failed={row.failed > 0 || undefined} />
                ))}
              </span>
              <span className={styles.value}>
                {formatDuration(row.busyMs)}
                <span className={styles.sub}>
                  busy · {row.jobs} {row.jobs === 1 ? 'job' : 'jobs'} · {formatDuration(row.computeMs)} compute{row.failed ? ` · ${row.failed} failed` : ''}
                </span>
              </span>
              <span className="visually-hidden">{said}</span>
            </li>
          );
        })}
      </ol>
    </figure>
  );
}

/**
 * Two small tables: the book's passes (bursts of activity: the initial end-to-end run,
 * then re-runs and derived material) and the models that did the work.
 */
import type { ModelStats, PipelinePass } from '../../lib/api/types/stats';
import { KIND_LABELS } from '../pipeline/model';
import { formatCount, formatDuration, formatNumber, formatUsd, NONE } from './format';
import styles from './Stats.module.css';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function PassTable({ passes }: { passes: readonly PipelinePass[] }) {
  if (passes.length === 0) return <p className={styles.empty}>Nothing has run yet.</p>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Pass</th>
            <th scope="col" className={styles.num}>Wall clock</th>
            <th scope="col" className={styles.num}>Busy</th>
            <th scope="col" className={styles.num}>Compute</th>
            <th scope="col" className={styles.num}>Parallelism</th>
            <th scope="col" className={styles.num}>Jobs</th>
            <th scope="col" className={styles.num}>Tokens</th>
          </tr>
        </thead>
        <tbody>
          {passes.map((p) => (
            <tr key={p.index}>
              <th scope="row">
                {when.format(new Date(p.started_at))}
                <span className={styles.sub}>{p.includes_parse ? 'Parsed the book' : p.stages.map((s) => KIND_LABELS[s.kind]).join(', ')}</span>
              </th>
              <td className={styles.num}>{formatDuration(p.wall_ms)}</td>
              <td className={styles.num}>{formatDuration(p.active_ms)}</td>
              <td className={styles.num}>{formatDuration(p.compute_ms)}</td>
              <td className={styles.num}>{p.active_ms ? `${formatNumber(p.compute_ms / p.active_ms)}×` : NONE}</td>
              <td className={styles.num}>{p.jobs}</td>
              <td className={styles.num}>{formatCount(p.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ModelTable({ models }: { models: readonly ModelStats[] }) {
  if (models.length === 0) return <p className={styles.empty}>No model call is on record.</p>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col" className={styles.num}>Calls</th>
            <th scope="col" className={styles.num}>Tokens</th>
            <th scope="col" className={styles.num}>Median call</th>
            <th scope="col" className={styles.num}>p95 call</th>
            <th scope="col" className={styles.num}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.model}>
              <th scope="row">
                <code>{m.model}</code>
                {m.tiers.length ? <span className={styles.sub}>{m.tiers.join(', ')}</span> : null}
              </th>
              <td className={styles.num}>{m.calls}</td>
              <td className={styles.num}>{formatCount(m.tokens)}</td>
              <td className={styles.num}>{formatDuration(m.duration.p50_ms)}</td>
              <td className={styles.num}>{formatDuration(m.duration.p95_ms)}</td>
              <td className={styles.num}>{formatUsd(m.cost_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

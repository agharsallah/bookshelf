/**
 * Two small tables: the book's passes (bursts of activity: the initial end-to-end run,
 * then re-runs and derived material) and the models that did the work.
 */
import type { ModelStats, PipelinePass } from '../../lib/api/types/stats';
import { KIND_LABELS } from '../pipeline/model';
import { formatCount, formatDuration, formatNumber, formatUsd, NONE } from './format';
import { StatsTable, type StatsColumn } from './StatsTable';
import styles from './Stats.module.css';

const when = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

const parallelism = (p: PipelinePass) => (p.active_ms ? p.compute_ms / p.active_ms : null);

const PASS_COLUMNS: StatsColumn<PipelinePass>[] = [
  {
    key: 'started',
    label: 'Pass',
    value: (p) => Date.parse(p.started_at),
    cell: (p) => (
      <>
        {when.format(new Date(p.started_at))}
        <span className={styles.sub}>{p.includes_parse ? 'Parsed the book' : p.stages.map((s) => KIND_LABELS[s.kind]).join(', ')}</span>
      </>
    ),
  },
  { key: 'wall', label: 'Wall clock', numeric: true, value: (p) => p.wall_ms, cell: (p) => formatDuration(p.wall_ms) },
  { key: 'busy', label: 'Busy', numeric: true, title: 'Time at least one job was running', value: (p) => p.active_ms, cell: (p) => formatDuration(p.active_ms) },
  { key: 'compute', label: 'Compute', numeric: true, value: (p) => p.compute_ms, cell: (p) => formatDuration(p.compute_ms) },
  {
    key: 'parallelism',
    label: 'Parallelism',
    numeric: true,
    value: parallelism,
    cell: (p) => {
      const x = parallelism(p);
      return x === null ? NONE : `${formatNumber(x)}×`;
    },
  },
  { key: 'jobs', label: 'Jobs', numeric: true, value: (p) => p.jobs, cell: (p) => p.jobs },
  { key: 'tokens', label: 'Tokens', numeric: true, value: (p) => p.tokens, cell: (p) => formatCount(p.tokens) },
];

export function PassTable({ passes, pageSize = 8 }: { passes: readonly PipelinePass[]; pageSize?: number }) {
  if (passes.length === 0) return <p className={styles.empty}>Nothing has run yet.</p>;
  return <StatsTable rows={passes} columns={PASS_COLUMNS} rowKey={(p) => String(p.index)} noun="passes" label="Passes" pageSize={pageSize} />;
}

const MODEL_COLUMNS: StatsColumn<ModelStats>[] = [
  {
    key: 'model',
    label: 'Model',
    value: (m) => m.model,
    cell: (m) => (
      <>
        <code>{m.model}</code>
        {m.tiers.length ? <span className={styles.sub}>{m.tiers.join(', ')}</span> : null}
      </>
    ),
  },
  { key: 'calls', label: 'Calls', numeric: true, value: (m) => m.calls, cell: (m) => m.calls },
  { key: 'tokens', label: 'Tokens', numeric: true, value: (m) => m.tokens, cell: (m) => formatCount(m.tokens) },
  { key: 'p50', label: 'Median call', numeric: true, value: (m) => m.duration.p50_ms, cell: (m) => formatDuration(m.duration.p50_ms) },
  { key: 'p95', label: 'p95 call', numeric: true, value: (m) => m.duration.p95_ms, cell: (m) => formatDuration(m.duration.p95_ms) },
  { key: 'cost', label: 'Cost', numeric: true, value: (m) => m.cost_usd, cell: (m) => formatUsd(m.cost_usd) },
];

export function ModelTable({ models, pageSize = 10 }: { models: readonly ModelStats[]; pageSize?: number }) {
  if (models.length === 0) return <p className={styles.empty}>No model call is on record.</p>;
  return (
    <StatsTable
      rows={models}
      columns={MODEL_COLUMNS}
      rowKey={(m) => m.model}
      noun="models"
      label="Models"
      initialSort={{ key: 'tokens', dir: 'desc' }}
      pageSize={pageSize}
    />
  );
}

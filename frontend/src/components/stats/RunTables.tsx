/**
 * Small tables over runs: the book's passes (bursts of activity: the initial end-to-end
 * run, then re-runs and derived material), the models that did the work, and where the
 * compute time went stage by stage.
 */
import type { ModelStats, PipelinePass, StageSpan } from '../../lib/api/types/stats';
import { KIND_LABELS } from '../pipeline/model';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd, NONE } from './format';
import { share } from './model';
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

function stageColumns(total: number, max: number): StatsColumn<StageSpan>[] {
  return [
    { key: 'stage', label: 'Stage', value: (s) => KIND_LABELS[s.kind], cell: (s) => KIND_LABELS[s.kind] },
    {
      key: 'compute',
      label: 'Compute',
      firstDir: 'desc',
      title: 'Sum of the stage’s job run times',
      value: (s) => s.compute_ms,
      cell: (s) => (
        <span className={styles.barCell}>
          <span className={styles.track} aria-hidden="true">
            {s.compute_ms > 0 ? <span className={styles.fill} style={{ inlineSize: `${share(s.compute_ms, max)}%` }} /> : null}
          </span>
          <span className={styles.num}>
            {formatDuration(s.compute_ms)}
            <span className={styles.sub}>{formatPercent(total ? s.compute_ms / total : null)}</span>
          </span>
        </span>
      ),
    },
    { key: 'busy', label: 'Busy', numeric: true, title: 'Time at least one of its jobs was running', value: (s) => s.busy_ms, cell: (s) => formatDuration(s.busy_ms) },
    {
      key: 'jobs',
      label: 'Jobs',
      numeric: true,
      value: (s) => s.jobs.total,
      cell: (s) => (
        <>
          {s.jobs.total}
          {s.jobs.failed ? <span className={`${styles.sub} ${styles.warn}`}>{s.jobs.failed} failed</span> : null}
        </>
      ),
    },
    { key: 'mean', label: 'Mean job', numeric: true, value: (s) => s.duration.mean_ms, cell: (s) => formatDuration(s.duration.mean_ms) },
    { key: 'p50', label: 'Median', numeric: true, value: (s) => s.duration.p50_ms, cell: (s) => formatDuration(s.duration.p50_ms) },
    { key: 'p95', label: 'p95', numeric: true, value: (s) => s.duration.p95_ms, cell: (s) => formatDuration(s.duration.p95_ms) },
    { key: 'max', label: 'Longest', numeric: true, value: (s) => s.duration.max_ms, cell: (s) => formatDuration(s.duration.max_ms) },
    { key: 'tokens', label: 'Tokens', numeric: true, value: (s) => s.tokens, cell: (s) => formatCount(s.tokens) },
    {
      key: 'per_minute',
      label: 'Tokens / min',
      numeric: true,
      title: 'Tokens per minute of compute: how token-dense the stage’s time is',
      value: (s) => (s.compute_ms ? s.tokens / (s.compute_ms / 60_000) : null),
      cell: (s) => (s.compute_ms && s.tokens ? formatCount(s.tokens / (s.compute_ms / 60_000)) : NONE),
    },
  ];
}

export function StageTimeTable({ stages, pageSize = 12 }: { stages: readonly StageSpan[]; pageSize?: number }) {
  if (stages.length === 0) return <p className={styles.empty}>No stage has run yet.</p>;
  const total = stages.reduce((sum, s) => sum + s.compute_ms, 0);
  const max = Math.max(0, ...stages.map((s) => s.compute_ms));
  return (
    <StatsTable
      rows={stages}
      columns={stageColumns(total, max)}
      rowKey={(s) => s.kind}
      noun="stages"
      label="Time by stage"
      initialSort={{ key: 'compute', dir: 'desc' }}
      pageSize={pageSize}
    />
  );
}

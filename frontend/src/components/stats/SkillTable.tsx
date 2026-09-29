/**
 * Skill by skill: the numbers a prompt change should move. Cost (tokens and share),
 * speed (median and p95), reliability (failures, second tries, repairs) and quality
 * (grounding, gate flags), with the most common flag and error spelled out.
 * Most tokens first; any column sorts.
 */
import type { SkillStats } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd, NONE } from './format';
import { share } from './model';
import { StatsTable, type StatsColumn } from './StatsTable';
import styles from './Stats.module.css';

function columns(total: number, max: number): StatsColumn<SkillStats>[] {
  const rate = (key: string, label: string, read: (s: SkillStats) => number | null, title?: string): StatsColumn<SkillStats> => ({
    key,
    label,
    numeric: true,
    title,
    value: read,
    cell: (s) => formatPercent(read(s)),
  });
  return [
    {
      key: 'skill',
      label: 'Skill',
      value: (s) => s.skill,
      cell: (s) => (
        <>
          {s.skill}
          <span className={styles.sub}>{[s.tiers.join('/'), s.versions.length ? `v${s.versions.join(', v')}` : ''].filter(Boolean).join(' · ') || NONE}</span>
        </>
      ),
    },
    {
      key: 'jobs',
      label: 'Jobs',
      numeric: true,
      value: (s) => s.jobs.total,
      cell: (s) => (
        <>
          {s.jobs.total}
          <span className={styles.sub}>{s.calls} calls</span>
        </>
      ),
    },
    {
      key: 'tokens',
      label: 'Tokens',
      firstDir: 'desc',
      value: (s) => s.tokens.tokens,
      cell: (s) => (
        <span className={styles.barCell}>
          <span className={styles.track} aria-hidden="true">
            <span className={styles.fill} style={{ inlineSize: `${share(s.tokens.tokens, max)}%` }} />
          </span>
          <span className={styles.num}>
            {formatCount(s.tokens.tokens)}
            <span className={styles.sub}>{formatPercent(total ? s.tokens.tokens / total : null)}</span>
          </span>
        </span>
      ),
    },
    { key: 'per_job', label: 'Per job', numeric: true, value: (s) => s.tokens_per_job, cell: (s) => formatCount(s.tokens_per_job) },
    {
      key: 'per_word',
      label: 'Per word out',
      numeric: true,
      title: 'Tokens per word of output',
      value: (s) => s.tokens_per_output_word,
      cell: (s) => formatNumber(s.tokens_per_output_word, 0),
    },
    { key: 'p50', label: 'Median', numeric: true, value: (s) => s.duration.p50_ms, cell: (s) => formatDuration(s.duration.p50_ms) },
    { key: 'p95', label: 'p95', numeric: true, value: (s) => s.duration.p95_ms, cell: (s) => formatDuration(s.duration.p95_ms) },
    {
      ...rate('failed', 'Failed', (s) => s.failure_rate),
      cellClass: (s) => ((s.failure_rate ?? 0) >= 0.1 ? styles.warn : undefined),
    },
    rate('retry', '2nd try', (s) => s.schema_retry_rate, 'Outputs that needed a second try to pass the schema'),
    rate('repair', 'Repaired', (s) => s.repair_rate),
    rate('flagged', 'Flagged', (s) => s.needs_review_rate, 'Outputs a gate flagged for review'),
    {
      key: 'grounding',
      label: 'Grounding',
      numeric: true,
      value: (s) => s.grounding_mean,
      cellClass: (s) => ((s.grounding_mean ?? 1) < 0.9 ? styles.warn : undefined),
      cell: (s) => (
        <>
          {formatPercent(s.grounding_mean, 1)}
          {s.grounding_min !== null ? <span className={styles.sub}>min {formatPercent(s.grounding_min)}</span> : null}
        </>
      ),
    },
    rate('cache', 'Cache hits', (s) => s.cache_hit_rate),
    { key: 'cost', label: 'Cost', numeric: true, value: (s) => s.tokens.cost_usd, cell: (s) => formatUsd(s.tokens.cost_usd) },
    {
      key: 'top',
      label: 'Top flag · top error',
      cellClass: () => styles.wrap,
      cell: (s) => (
        <>
          {s.flags[0] ? `${s.flags[0].name} ×${s.flags[0].count}` : NONE}
          {s.errors[0] ? (
            <span className={styles.sub}>
              {s.errors[0].name} ×{s.errors[0].count}
            </span>
          ) : null}
        </>
      ),
    },
  ];
}

export function SkillTable({ skills, pageSize = 12 }: { skills: readonly SkillStats[]; pageSize?: number }) {
  if (skills.length === 0) return <p className={styles.empty}>No skill has run yet.</p>;
  const total = skills.reduce((sum, s) => sum + s.tokens.tokens, 0);
  const max = Math.max(0, ...skills.map((s) => s.tokens.tokens));
  return (
    <StatsTable
      rows={skills}
      columns={columns(total, max)}
      rowKey={(s) => s.skill}
      noun="skills"
      label="Skills"
      initialSort={{ key: 'tokens', dir: 'desc' }}
      pageSize={pageSize}
    />
  );
}

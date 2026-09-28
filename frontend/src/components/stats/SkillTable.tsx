/**
 * Skill by skill: the numbers a prompt change should move. Cost (tokens and share),
 * speed (median and p95), reliability (failures, second tries, repairs) and quality
 * (grounding, gate flags), with the most common flag and error spelled out.
 */
import type { SkillStats } from '../../lib/api/types/stats';
import { formatCount, formatDuration, formatNumber, formatPercent, formatUsd, NONE } from './format';
import { share } from './model';
import styles from './Stats.module.css';

export function SkillTable({ skills }: { skills: readonly SkillStats[] }) {
  if (skills.length === 0) return <p className={styles.empty}>No skill has run yet.</p>;
  const total = skills.reduce((sum, s) => sum + s.tokens.tokens, 0);
  const max = Math.max(0, ...skills.map((s) => s.tokens.tokens));
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Skill</th>
            <th scope="col" className={styles.num}>Jobs</th>
            <th scope="col">Tokens</th>
            <th scope="col" className={styles.num}>Per job</th>
            <th scope="col" className={styles.num}>Per word out</th>
            <th scope="col" className={styles.num}>Median</th>
            <th scope="col" className={styles.num}>p95</th>
            <th scope="col" className={styles.num}>Failed</th>
            <th scope="col" className={styles.num}>2nd try</th>
            <th scope="col" className={styles.num}>Repaired</th>
            <th scope="col" className={styles.num}>Flagged</th>
            <th scope="col" className={styles.num}>Grounding</th>
            <th scope="col" className={styles.num}>Cache hits</th>
            <th scope="col" className={styles.num}>Cost</th>
            <th scope="col">Top flag · top error</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr key={s.skill}>
              <th scope="row">
                {s.skill}
                <span className={styles.sub}>
                  {[s.tiers.join('/'), s.versions.length ? `v${s.versions.join(', v')}` : ''].filter(Boolean).join(' · ') || NONE}
                </span>
              </th>
              <td className={styles.num}>
                {s.jobs.total}
                <span className={styles.sub}>{s.calls} calls</span>
              </td>
              <td>
                <span className={styles.barCell}>
                  <span className={styles.track} aria-hidden="true">
                    <span className={styles.fill} style={{ inlineSize: `${share(s.tokens.tokens, max)}%` }} />
                  </span>
                  <span className={styles.num}>
                    {formatCount(s.tokens.tokens)}
                    <span className={styles.sub}>{formatPercent(total ? s.tokens.tokens / total : null)}</span>
                  </span>
                </span>
              </td>
              <td className={styles.num}>{formatCount(s.tokens_per_job)}</td>
              <td className={styles.num}>{formatNumber(s.tokens_per_output_word, 0)}</td>
              <td className={styles.num}>{formatDuration(s.duration.p50_ms)}</td>
              <td className={styles.num}>{formatDuration(s.duration.p95_ms)}</td>
              <td className={`${styles.num} ${(s.failure_rate ?? 0) >= 0.1 ? styles.warn : ''}`}>{formatPercent(s.failure_rate)}</td>
              <td className={styles.num}>{formatPercent(s.schema_retry_rate)}</td>
              <td className={styles.num}>{formatPercent(s.repair_rate)}</td>
              <td className={styles.num}>{formatPercent(s.needs_review_rate)}</td>
              <td className={`${styles.num} ${(s.grounding_mean ?? 1) < 0.9 ? styles.warn : ''}`}>
                {formatPercent(s.grounding_mean, 1)}
                {s.grounding_min !== null ? <span className={styles.sub}>min {formatPercent(s.grounding_min)}</span> : null}
              </td>
              <td className={styles.num}>{formatPercent(s.cache_hit_rate)}</td>
              <td className={styles.num}>{formatUsd(s.tokens.cost_usd)}</td>
              <td className={styles.wrap}>
                {s.flags[0] ? `${s.flags[0].name} ×${s.flags[0].count}` : NONE}
                {s.errors[0] ? (
                  <span className={styles.sub}>
                    {s.errors[0].name} ×{s.errors[0].count}
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

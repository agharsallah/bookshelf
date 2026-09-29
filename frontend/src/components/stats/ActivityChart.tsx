/**
 * The library's work day by day: one bar per day in the chosen metric (compute time,
 * tokens, jobs or cost) over the chosen range, the part spent on failed jobs stacked on
 * top in its own colour. A hover names the day's every figure; the range's total, its
 * busiest day and its average active day sit above; the days are also a table.
 */
import { useState, type CSSProperties } from 'react';
import type { ActivityDay } from '../../lib/api/types/stats';
import {
  axisTicks,
  dayParts,
  dayValue,
  fillDays,
  fittingRange,
  formatMetric,
  METRIC_LABELS,
  RANGE_LABELS,
  splitsFailures,
  summarize,
  type ActivityMetric,
  type ActivityRange,
} from './activity';
import { formatCount, formatDuration, formatUsd, NONE } from './format';
import styles from './ActivityChart.module.css';
import stats from './Stats.module.css';

const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: Record<T, string>; value: T; onChange: (v: T) => void }) {
  return (
    <div className={stats.segmented} role="group" aria-label={label}>
      {(Object.keys(options) as T[]).map((option) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>
          {options[option]}
        </button>
      ))}
    </div>
  );
}

function DayDetail({ day }: { day: ActivityDay }) {
  return (
    <>
      <strong>{longDay.format(asDate(day.day))}</strong>
      <span>
        {day.jobs} jobs{day.failed ? `, ${day.failed} failed` : ''} · {day.books} {day.books === 1 ? 'book' : 'books'}
      </span>
      <span>
        {formatDuration(day.compute_ms)} compute · {formatCount(day.tokens)} tokens · {formatUsd(day.cost_usd)}
      </span>
    </>
  );
}

interface Props {
  days: readonly ActivityDay[];
  /** The day the figures run to (`YYYY-MM-DD`), so server and browser draw the same range. */
  today: string;
}

export function ActivityChart({ days, today }: Props) {
  const [metric, setMetric] = useState<ActivityMetric>('compute');
  const [range, setRange] = useState<ActivityRange>(() => fittingRange(days, today));
  const [hover, setHover] = useState<number | null>(null);
  if (days.length === 0) return <p className={stats.empty}>Nothing has run yet.</p>;

  const shown = fillDays(days, today, range);
  const summary = summarize(shown, metric);
  const ticks = axisTicks(Math.max(0, ...shown.map((d) => dayValue(d, metric))), metric);
  const top = ticks.at(-1) || 1;
  const split = splitsFailures(metric);
  const hovered = hover === null ? null : shown[hover];
  const [first, last] = [shown[0], shown.at(-1)];
  const labelled = new Set([0, Math.floor((shown.length - 1) / 2), shown.length - 1]);

  return (
    <div className={styles.activity}>
      <div className={styles.controls}>
        <Segmented label="Measure" options={METRIC_LABELS} value={metric} onChange={setMetric} />
        <Segmented label="Range" options={RANGE_LABELS} value={range} onChange={(r) => {
            setRange(r);
            setHover(null);
          }} />
      </div>

      <dl className={styles.summary} aria-label={`${METRIC_LABELS[metric]} over ${RANGE_LABELS[range].toLowerCase()}`}>
        <div>
          <dt>Total</dt>
          <dd>{formatMetric(summary.total, metric)}</dd>
        </div>
        <div>
          <dt>Active days</dt>
          <dd>
            {summary.activeDays} <span>of {summary.days}</span>
          </dd>
        </div>
        <div>
          <dt>Per active day</dt>
          <dd>{summary.perActiveDay === null ? NONE : formatMetric(summary.perActiveDay, metric)}</dd>
        </div>
        <div>
          <dt>Busiest day</dt>
          <dd>
            {summary.busiest ? (
              <>
                {formatMetric(dayValue(summary.busiest, metric), metric)} <span>on {shortDay.format(asDate(summary.busiest.day))}</span>
              </>
            ) : (
              NONE
            )}
          </dd>
        </div>
      </dl>

      {split ? (
        <ul className={stats.legend} aria-label="Series">
          <li>
            <span className={stats.swatch} style={{ '--fill': 'var(--series-1)' } as CSSProperties} aria-hidden="true" />
            Finished
          </li>
          <li>
            <span className={stats.swatch} style={{ '--fill': 'var(--tone-important)' } as CSSProperties} aria-hidden="true" />
            Failed
          </li>
        </ul>
      ) : null}

      <figure className={styles.chart} onMouseLeave={() => setHover(null)}>
        <figcaption className="visually-hidden">
          {METRIC_LABELS[metric]} per day, {first ? shortDay.format(asDate(first.day)) : ''} to {last ? shortDay.format(asDate(last.day)) : ''}. The table below lists every active day.
        </figcaption>
        <div className={styles.yAxis} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} style={{ insetBlockEnd: `${(t / top) * 100}%` }}>
              {t === 0 ? '0' : formatMetric(t, metric)}
            </span>
          ))}
        </div>
        <div className={styles.plot} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className={styles.grid} style={{ insetBlockEnd: `${(t / top) * 100}%` }} />
          ))}
          <div className={styles.bars} style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
            {shown.map((d, i) => {
              const { ok, failed } = dayParts(d, metric);
              return (
                <div key={d.day} className={styles.column} data-active={hover === i || undefined} onMouseEnter={() => setHover(i)}>
                  {failed > 0 && split ? <span className={styles.failed} style={{ blockSize: `${(failed / top) * 100}%` }} /> : null}
                  {ok > 0 ? <span className={styles.bar} style={{ blockSize: `${(ok / top) * 100}%` }} /> : null}
                </div>
              );
            })}
          </div>
          {hovered && hover !== null ? (
            <div className={styles.tooltip} style={{ '--at': `${((hover + 0.5) / shown.length) * 100}%` } as CSSProperties} data-side={hover > shown.length / 2 ? 'left' : 'right'}>
              <DayDetail day={hovered} />
            </div>
          ) : null}
        </div>
        <div className={styles.xAxis} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map((d, i) => (
            <span key={d.day} data-edge={i === 0 ? 'start' : i === shown.length - 1 ? 'end' : 'middle'}>
              {labelled.has(i) ? shortDay.format(asDate(d.day)) : ''}
            </span>
          ))}
        </div>
      </figure>

      <details className={styles.table}>
        <summary>Show the days as a table</summary>
        <div className={stats.scroll}>
          <table className={stats.table}>
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" className={stats.num}>Books</th>
                <th scope="col" className={stats.num}>Jobs</th>
                <th scope="col" className={stats.num}>Failed</th>
                <th scope="col" className={stats.num}>Compute</th>
                <th scope="col" className={stats.num}>Tokens</th>
                <th scope="col" className={stats.num}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {shown
                .filter((d) => d.jobs > 0 || d.cost_usd)
                .reverse()
                .map((d) => (
                  <tr key={d.day}>
                    <th scope="row">{longDay.format(asDate(d.day))}</th>
                    <td className={stats.num}>{d.books}</td>
                    <td className={stats.num}>{d.jobs}</td>
                    <td className={`${stats.num} ${d.failed ? stats.warn : ''}`}>{d.failed || NONE}</td>
                    <td className={stats.num}>{formatDuration(d.compute_ms)}</td>
                    <td className={stats.num}>{formatCount(d.tokens)}</td>
                    <td className={stats.num}>{formatUsd(d.cost_usd)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

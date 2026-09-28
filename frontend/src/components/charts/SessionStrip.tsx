/**
 * The last days, sitting by sitting: one row per day, the hours of the day across, each
 * session a bar from its start to its end in the color of the surface it was mostly on.
 */
import { scaleLinear } from 'd3-scale';
import type { Series } from './chart';
import { useWidth } from './chart';
import { Legend } from './Legend';
import { Frame, Tooltip, useTooltip } from './Tooltip';
import styles from './Charts.module.css';

export interface Sitting {
  key: string;
  /** Local day `YYYY-MM-DD`, and hours since its midnight (may run past 24 into the next). */
  day: string;
  from: number;
  to: number;
  series: string;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}

export interface SessionStripProps {
  days: readonly string[];
  sittings: readonly Sitting[];
  series: readonly Series[];
  label: string;
}

const LEFT = 64;
const ROW = 18;
const TOP = 16;

export function SessionStrip({ days, sittings, series, label }: SessionStripProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  if (sittings.length === 0) return <p className={styles.empty}>No sittings tracked in these days.</p>;
  const x = scaleLinear().domain([0, 24]).range([LEFT, Math.max(LEFT + 100, width - 8)]);
  const color = new Map(series.map((s) => [s.key, s.color]));
  const row = new Map(days.map((d, i) => [d, i]));
  const height = TOP + days.length * ROW;
  const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const used = series.filter((s) => sittings.some((t) => t.series === s.key));

  return (
    <Frame label={label} frameRef={ref}>
      <Legend series={used} />
      <svg className={styles.svg} width={width} height={height} role="img" aria-label={label} onPointerLeave={hide}>
        <g className={styles.grid}>
          {[0, 6, 12, 18, 24].map((h) => (
            <g key={h}>
              <line x1={x(h)} x2={x(h)} y1={TOP - 4} y2={height} />
              <text className={styles.tick} x={x(h)} y={10} textAnchor="middle">
                {String(h % 24).padStart(2, '0')}:00
              </text>
            </g>
          ))}
        </g>
        {days.map((d, i) => (
          <text key={d} className={styles.tick} x={0} y={TOP + i * ROW + ROW / 2} dy="0.32em">
            {dayLabel(d)}
          </text>
        ))}
        {sittings.map((s) => {
          const index = row.get(s.day);
          if (index === undefined) return null;
          const x0 = x(Math.min(24, s.from));
          const w = Math.max(3, x(Math.min(24, s.to)) - x0);
          const y = TOP + index * ROW + 4;
          const open = () => show({ x: x0 + w / 2, y: y + 5, title: s.title, rows: s.rows });
          return (
            <rect
              key={s.key}
              className={styles.mark}
              x={x0}
              y={y}
              width={w}
              height={ROW - 8}
              rx={3}
              fill={color.get(s.series) ?? 'var(--series-other)'}
              tabIndex={0}
              aria-label={`${s.title}`}
              onPointerEnter={open}
              onFocus={open}
              onBlur={hide}
            />
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </Frame>
  );
}

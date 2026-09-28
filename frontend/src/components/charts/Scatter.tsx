/**
 * Two measures of the same things (chapters: how long they are, how long you took), one dot
 * each, sized by a third. Each dot has a hit area well past its paint, and a line through
 * the origin marks your usual rate, so a dot above it is a chapter that slowed you down.
 */
import { scaleLinear, scaleSqrt } from 'd3-scale';
import { useWidth } from './chart';
import { Frame, Tooltip, useTooltip, type TipRow } from './Tooltip';
import styles from './Charts.module.css';

export interface ScatterPoint {
  key: string;
  x: number;
  y: number;
  size?: number;
  title: string;
  href?: string;
  rows?: TipRow[];
  color?: string;
}

export interface ScatterProps {
  points: readonly ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  label: string;
  /** Draw y = slope · x, labeled (your usual rate). */
  reference?: { slope: number; label: string };
  height?: number;
}

const MARGIN = { top: 16, right: 16, bottom: 40, left: 52 };

export function Scatter({ points, xLabel, yLabel, xFormat, yFormat, label, reference, height = 260 }: ScatterProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  if (points.length === 0) return <p className={styles.empty}>Nothing to plot yet.</p>;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const x = scaleLinear().domain([0, Math.max(1, ...points.map((p) => p.x))]).nice(4).range([0, innerW]);
  const y = scaleLinear().domain([0, Math.max(1, ...points.map((p) => p.y))]).nice(4).range([innerH, 0]);
  const r = scaleSqrt().domain([0, Math.max(1, ...points.map((p) => p.size ?? 0))]).range([4, 12]);
  const [x0, x1] = x.domain() as [number, number];
  const refEnd = reference ? Math.min(x1, (y.domain()[1] ?? 0) / Math.max(reference.slope, 1e-9)) : 0;

  return (
    <Frame label={label} frameRef={ref}>
      <svg className={styles.svg} width={width} height={height} role="img" aria-label={label} onPointerLeave={hide}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <g className={styles.grid}>
            {y.ticks(4).map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} />
                <text className={styles.tick} x={-8} dy="0.32em" textAnchor="end">
                  {yFormat(t)}
                </text>
              </g>
            ))}
          </g>
          {x.ticks(Math.max(2, Math.floor(innerW / 80))).map((t) => (
            <text key={t} className={styles.tick} x={x(t)} y={innerH + 16} textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
          <text className={styles.label} x={innerW} y={innerH + 34} textAnchor="end">
            {xLabel} →
          </text>
          <text className={styles.label} x={0} y={-4}>
            ↑ {yLabel}
          </text>
          {reference ? (
            <g>
              <line className={styles.crosshair} x1={x(x0)} y1={y(0)} x2={x(refEnd)} y2={y(refEnd * reference.slope)} strokeDasharray="0" />
              <text className={styles.tick} x={x(refEnd) - 4} y={y(refEnd * reference.slope) + 12} textAnchor="end">
                {reference.label}
              </text>
            </g>
          ) : null}
          <line className={styles.baseline} x2={innerW} y1={innerH} y2={innerH} />
          {points.map((p) => {
            const cx = x(p.x);
            const cy = y(p.y);
            const open = () => show({ x: MARGIN.left + cx, y: MARGIN.top + cy, title: p.title, rows: [{ label: yLabel, value: yFormat(p.y) }, { label: xLabel, value: xFormat(p.x) }, ...(p.rows ?? [])] });
            const dot = <circle className={`${styles.dot} ${styles.mark}`} cx={cx} cy={cy} r={r(p.size ?? 0)} fill={p.color ?? 'var(--series-1)'} fillOpacity={0.85} />;
            const hit = <circle className={styles.hit} cx={cx} cy={cy} r={Math.max(12, r(p.size ?? 0) + 4)} tabIndex={0} aria-label={`${p.title}: ${yFormat(p.y)}, ${xFormat(p.x)}`} onPointerEnter={open} onFocus={open} onBlur={hide} />;
            return (
              <g key={p.key}>
                {dot}
                {p.href ? <a href={p.href}>{hit}</a> : hit}
              </g>
            );
          })}
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </Frame>
  );
}

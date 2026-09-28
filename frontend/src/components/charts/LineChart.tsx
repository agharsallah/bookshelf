/**
 * One measure over time: a 2px line over a 10% wash, dots on the points, and a crosshair
 * that snaps to the nearest point and shows its values. The last point is labeled.
 */
import { scaleLinear, scaleTime } from 'd3-scale';
import { area, curveMonotoneX, line } from 'd3-shape';
import type { PointerEvent } from 'react';
import { useWidth } from './chart';
import { Frame, Tooltip, useTooltip, type TipRow } from './Tooltip';
import styles from './Charts.module.css';

export interface LinePoint {
  at: Date;
  value: number;
  title: string;
  rows?: TipRow[];
}

export interface LineChartProps {
  points: readonly LinePoint[];
  format: (value: number) => string;
  label: string;
  /** Fixed y extent (a score from 0 to 1); from 0 to the largest value by default. */
  domain?: [number, number];
  height?: number;
  color?: string;
}

const MARGIN = { top: 16, right: 40, bottom: 24, left: 44 };

export function LineChart({ points, format, label, domain, height = 200, color = 'var(--series-1)' }: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  if (points.length === 0) return <p className={styles.empty}>Nothing to plot yet.</p>;
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const times = points.map((p) => p.at.getTime());
  const first = Math.min(...times);
  const last = Math.max(...times);
  const x = scaleTime().domain(first === last ? [first - 86_400_000, last + 86_400_000] : [first, last]).range([0, innerW]);
  const y = scaleLinear().domain(domain ?? [0, Math.max(1e-9, ...points.map((p) => p.value))]).nice(4).range([innerH, 0]);
  const path = line<LinePoint>().x((p) => x(p.at)).y((p) => y(p.value)).curve(curveMonotoneX)(points) ?? '';
  const wash = area<LinePoint>().x((p) => x(p.at)).y0(innerH).y1((p) => y(p.value)).curve(curveMonotoneX)(points) ?? '';
  const end = points.at(-1);
  const active = tip ? points.find((p) => p.title === tip.title) : null;

  const nearest = (px: number) => points.reduce((best, p) => (Math.abs(x(p.at) - px) < Math.abs(x(best.at) - px) ? p : best), points[0] as LinePoint);
  const open = (p: LinePoint) => show({ x: MARGIN.left + x(p.at), y: MARGIN.top + y(p.value), title: p.title, rows: [{ label, value: format(p.value), color }, ...(p.rows ?? [])] });
  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    open(nearest(event.clientX - box.left));
  };

  return (
    <Frame label={label} frameRef={ref}>
      <svg className={styles.svg} width={width} height={height} role="img" aria-label={label}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <g className={styles.grid}>
            {y.ticks(4).map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} />
                <text className={styles.tick} x={-8} dy="0.32em" textAnchor="end">
                  {format(t)}
                </text>
              </g>
            ))}
          </g>
          {x.ticks(Math.max(2, Math.floor(innerW / 90))).map((t) => (
            <text key={t.getTime()} className={styles.tick} x={x(t)} y={innerH + 16} textAnchor="middle">
              {t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
            </text>
          ))}
          <path className={styles.area} d={wash} fill={color} />
          <path className={styles.line} d={path} stroke={color} />
          {active ? <line className={styles.crosshair} x1={x(active.at)} x2={x(active.at)} y2={innerH} /> : null}
          {points.map((p) => (
            <circle
              key={`${p.at.getTime()}:${p.title}`}
              className={styles.dot}
              cx={x(p.at)}
              cy={y(p.value)}
              r={4}
              fill={color}
              tabIndex={0}
              aria-label={`${p.title}: ${format(p.value)}`}
              onFocus={() => open(p)}
              onBlur={hide}
            />
          ))}
          {end ? (
            <text className={styles.value} x={x(end.at) + 8} y={y(end.value)} dy="0.32em">
              {format(end.value)}
            </text>
          ) : null}
          <line className={styles.baseline} x2={innerW} y1={innerH} y2={innerH} />
          <rect className={styles.hit} width={innerW} height={innerH} onPointerMove={onMove} onPointerLeave={hide} />
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </Frame>
  );
}

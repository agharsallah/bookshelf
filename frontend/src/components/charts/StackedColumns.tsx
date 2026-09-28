/**
 * Columns over time, stacked by series (minutes per day or week, by surface). One baseline,
 * a 2px surface gap between segments, the top segment's end rounded; hovering a column
 * lists every series at it. Pass one series for plain columns (a histogram, a forecast).
 */
import { scaleBand, scaleLinear } from 'd3-scale';
import { columnPath, type Series, useWidth } from './chart';
import { Legend } from './Legend';
import { Frame, Tooltip, useTooltip } from './Tooltip';
import styles from './Charts.module.css';

export interface Column {
  key: string;
  /** The axis label (may be skipped when crowded) and the tooltip title. */
  label: string;
  title?: string;
  values: Record<string, number>;
}

export interface StackedColumnsProps {
  columns: readonly Column[];
  series: readonly Series[];
  format: (value: number) => string;
  /** Format for the y ticks; `format` by default. */
  tickFormat?: (value: number) => string;
  /** Tick values up to the largest total (round minutes and hours for time); d3's by default. */
  ticks?: (max: number) => number[];
  label: string;
  height?: number;
  /** Write each column's total on its cap (only when there is room). */
  capLabels?: boolean;
}

const MARGIN = { top: 16, right: 8, bottom: 24, left: 44 };
const GAP = 2;

export function StackedColumns({ columns, series, format, tickFormat = format, ticks, label, height = 200, capLabels = false }: StackedColumnsProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  if (columns.length === 0) return <p className={styles.empty}>Nothing in this period yet.</p>;
  const totals = columns.map((c) => series.reduce((sum, s) => sum + (c.values[s.key] ?? 0), 0));
  const innerW = Math.max(0, width - MARGIN.left - MARGIN.right);
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const x = scaleBand<string>().domain(columns.map((c) => c.key)).range([0, innerW]).paddingInner(columns.length > 40 ? 0.15 : 0.3).paddingOuter(0.1);
  const top = Math.max(1, ...totals);
  const y = scaleLinear().domain([0, top]).range([innerH, 0]);
  let tickValues: number[];
  if (ticks) {
    // The given ticks, plus one more step when the tallest column is above the last.
    const given = ticks(top);
    const step = given[1] ?? top;
    const last = given.at(-1) ?? 0;
    tickValues = last < top ? [...given, last + step] : given;
    y.domain([0, tickValues.at(-1) ?? top]);
  } else {
    y.nice(4);
    tickValues = y.ticks(4);
  }
  const barW = Math.min(24, x.bandwidth());
  const every = Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(innerW / 56))));
  const values: Record<string, string> = Object.fromEntries(series.map((s) => [s.key, format(columns.reduce((sum, c) => sum + (c.values[s.key] ?? 0), 0))]));

  const hover = (i: number) => {
    const column = columns[i];
    if (!column) return;
    const cx = MARGIN.left + (x(column.key) ?? 0) + x.bandwidth() / 2;
    const cy = MARGIN.top + y(totals[i] ?? 0);
    show({
      x: cx,
      y: Math.max(cy, 24),
      title: column.title ?? column.label,
      rows: [
        ...(series.length > 1 ? [{ label: 'total', value: format(totals[i] ?? 0) }] : []),
        ...series.filter((s) => (column.values[s.key] ?? 0) > 0).map((s) => ({ label: s.label, value: format(column.values[s.key] ?? 0), color: s.color })),
      ],
    });
  };

  return (
    <Frame label={label} frameRef={ref}>
      <Legend series={series} values={values} />
      <svg className={styles.svg} width={width} height={height} role="img" aria-label={label} onPointerLeave={hide}>
        <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
          <g className={styles.grid}>
            {tickValues.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={innerW} />
                <text className={styles.tick} x={-8} dy="0.32em" textAnchor="end">
                  {tickFormat(t)}
                </text>
              </g>
            ))}
          </g>
          {columns.map((column, i) => {
            const x0 = (x(column.key) ?? 0) + (x.bandwidth() - barW) / 2;
            let top = innerH;
            const present = series.filter((s) => (column.values[s.key] ?? 0) > 0);
            return (
              <g key={column.key}>
                {present.map((s, j) => {
                  const h = innerH - y(column.values[s.key] ?? 0);
                  const gap = j > 0 ? GAP : 0;
                  top -= h;
                  const yTop = top;
                  const height = Math.max(0, h - gap);
                  return j === present.length - 1 ? (
                    <path key={s.key} className={styles.mark} d={columnPath(x0, yTop, barW, height)} fill={s.color} />
                  ) : (
                    <rect key={s.key} className={styles.mark} x={x0} y={yTop} width={barW} height={height} fill={s.color} />
                  );
                })}
                {capLabels && totals[i] ? (
                  <text className={styles.value} x={x0 + barW / 2} y={y(totals[i] ?? 0) - 4} textAnchor="middle">
                    {format(totals[i] ?? 0)}
                  </text>
                ) : null}
                <rect
                  className={styles.hit}
                  x={x(column.key) ?? 0}
                  y={0}
                  width={x.bandwidth()}
                  height={innerH}
                  tabIndex={0}
                  aria-label={`${column.title ?? column.label}: ${format(totals[i] ?? 0)}`}
                  onPointerEnter={() => hover(i)}
                  onFocus={() => hover(i)}
                  onBlur={hide}
                />
                {i % every === 0 ? (
                  <text className={styles.tick} x={(x(column.key) ?? 0) + x.bandwidth() / 2} y={innerH + 16} textAnchor="middle">
                    {column.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          <line className={styles.baseline} x2={innerW} y1={innerH} y2={innerH} />
        </g>
      </svg>
      <Tooltip tip={tip} width={width} />
    </Frame>
  );
}

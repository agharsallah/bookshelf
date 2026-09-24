/**
 * Native SVG chart for transcribed figures (bar, line, scatter). Geometry comes from
 * the pure `layoutChart`; this file only draws it. Server-rendered it is a static,
 * accessible figure (role=img + label + hidden data table); hydrated it adds a
 * crosshair tooltip on pointer and arrow keys.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ChartBlock as Chart } from '../../lib/contract';
import { BlockFigure } from './BlockFigure';
import {
  CHART_HEIGHT,
  CHART_WIDTH,
  MIN_CHART_WIDTH,
  describeChart,
  formatValue,
  layoutChart,
  type SeriesGeometry,
} from './chart/layout';
import { nearestIndex } from './chart/scales';
import styles from './Chart.module.css';

function xText(value: string | number): string {
  return typeof value === 'number' ? String(value) : value;
}

/** Legend for two or more series; the key mirrors the mark (bar, line, dot). */
function Legend({ kind, series }: { kind: Chart['kind']; series: SeriesGeometry[] }) {
  if (series.length < 2) return null;
  return (
    <ul className={styles.legend} aria-label="Series">
      {series.map((s) => (
        <li key={s.name}>
          <span className={styles.key} data-kind={kind} style={{ background: s.color }} aria-hidden="true" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ block, id }: { block: Chart; id: string }) {
  return (
    // The wrapper is what is hidden: a table ignores `width: 1px` and would widen the page.
    <div className="visually-hidden">
      <table id={id}>
        <caption>{block.title ?? 'Chart data'}</caption>
        <thead>
          <tr>
            <th scope="col">{block.x.label}</th>
            {block.series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.x.values.map((x, i) => (
            <tr key={i}>
              <th scope="row">{xText(x)}</th>
              {block.series.map((s) => (
                <td key={s.name}>{formatValue(s.values[i] ?? null)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Measured width of the chart frame once hydrated, so text stays at its real size in
 * any pane. Server output uses the default width and scales with the viewBox.
 */
function useFrameWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(CHART_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0);
      if (measured > 0) setWidth(Math.max(MIN_CHART_WIDTH, measured));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function ChartBlock({ block }: { block: Chart }) {
  const [frameRef, width] = useFrameWidth();
  const layout = layoutChart(block, width);
  const tableId = useId();
  const [active, setActive] = useState<number | null>(null);
  const { plot } = layout;

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const x = ((event.clientX - box.left) / box.width) * width;
    setActive(nearestIndex(layout.xPositions, x));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = block.x.values.length - 1;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    setActive((current) => Math.min(last, Math.max(0, (current ?? (step > 0 ? -1 : last + 1)) + step)));
  };

  const activeX = active === null ? null : layout.xPositions[active];

  return (
    <BlockFigure kind="chart" caption={block.title} cites={block.cites} confidence={block.confidence}>
      <div className={styles.head}>
        {block.y?.label ? <span className={styles.yLabel}>{block.y.label}</span> : null}
        <Legend kind={block.kind} series={layout.series} />
      </div>
      <div
        ref={frameRef}
        className={styles.frame}
        tabIndex={0}
        role="group"
        aria-label={`${describeChart(block)} Use the left and right arrow keys to read values.`}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          className={styles.svg}
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
          role="img"
          aria-label={describeChart(block)}
          aria-describedby={tableId}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
        >
          <g className={styles.grid}>
            {layout.yTicks.map((tick) => (
              <g key={tick.value}>
                <line x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} />
                <text x={plot.left - 8} y={tick.y} dy="0.32em" textAnchor="end">
                  {tick.label}
                </text>
              </g>
            ))}
          </g>
          <line className={styles.baseline} x1={plot.left} x2={plot.right} y1={layout.baseline} y2={layout.baseline} />
          <g className={styles.xAxis}>
            {layout.xLabels.map((l) => (
              <text key={`${l.x}-${l.label}`} x={l.x} y={plot.bottom + 18} textAnchor="middle">
                {l.label}
              </text>
            ))}
            <text className={styles.axisTitle} x={(plot.left + plot.right) / 2} y={CHART_HEIGHT - 4} textAnchor="middle">
              {block.x.label}
            </text>
          </g>
          {block.kind !== 'bar' && activeX !== null && activeX !== undefined ? (
            <line className={styles.crosshair} x1={activeX} x2={activeX} y1={plot.top} y2={plot.bottom} />
          ) : null}
          {layout.series.map((s) => (
            <g key={s.name} style={{ color: s.color }} data-series={s.name}>
              {s.bars.map((bar) => (
                <path key={bar.index} className={styles.bar} d={bar.d} data-active={bar.index === active || undefined} />
              ))}
              {s.line ? <path className={styles.line} d={s.line} /> : null}
              {block.kind !== 'bar'
                ? s.points.map((p, i) =>
                    p && (block.kind === 'scatter' || i === active) ? (
                      <circle key={i} className={styles.dot} cx={p.x} cy={p.y} r={block.kind === 'scatter' ? 4.5 : 4} />
                    ) : null,
                  )
                : null}
              {s.endLabel ? (
                <text className={styles.endLabel} x={s.endLabel.x} y={s.endLabel.y} dy="0.32em">
                  {s.name}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
        {active !== null && activeX !== undefined && activeX !== null ? (
          <div
            className={styles.tooltip}
            role="status"
            style={{ left: `${(activeX / width) * 100}%` }}
            data-flip={activeX > width * 0.66 || undefined}
          >
            <span className={styles.tooltipX}>{xText(block.x.values[active] ?? '')}</span>
            {layout.series.map((s, i) => (
              <span key={s.name} className={styles.tooltipRow}>
                <span className={styles.tooltipKey} style={{ background: s.color }} aria-hidden="true" />
                <strong>{formatValue(block.series[i]?.values[active] ?? null)}</strong>
                <span>{s.name}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <DataTable block={block} id={tableId} />
    </BlockFigure>
  );
}

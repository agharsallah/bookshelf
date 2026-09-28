/**
 * A year of days as a calendar: one column per week, Monday on top, each day shaded in
 * five bands of one hue by its value. Scrolls sideways inside its frame on narrow screens.
 */
import { level, sequential, useWidth } from './chart';
import { Frame, Tooltip, useTooltip } from './Tooltip';
import styles from './Charts.module.css';

export interface CalendarDay {
  /** `YYYY-MM-DD` */
  date: string;
  value: number;
  /** Extra tooltip rows, already formatted. */
  rows?: { label: string; value: string }[];
}

export interface CalendarHeatmapProps {
  days: readonly CalendarDay[];
  /** The first and last day to draw, `YYYY-MM-DD`. */
  from: string;
  to: string;
  format: (value: number) => string;
  label: string;
}

const CELL = 12;
const GAP = 2;
const TOP = 16;
const LEFT = 28;
const WEEKDAYS = ['Mon', '', 'Wed', '', 'Fri', '', ''];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86_400_000;

const parse = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Monday is 0. */
const weekday = (ms: number) => (new Date(ms).getUTCDay() + 6) % 7;

export interface CalendarCell {
  date: string;
  week: number;
  weekday: number;
  value: number;
}

/** Every day from `from` to `to` placed on its week column and weekday row. */
export function calendarCells(days: readonly CalendarDay[], from: string, to: string): CalendarCell[] {
  const values = new Map(days.map((d) => [d.date, d.value]));
  const start = parse(from);
  const offset = weekday(start);
  const cells: CalendarCell[] = [];
  for (let ms = start; ms <= parse(to); ms += DAY_MS) {
    const index = Math.round((ms - start) / DAY_MS) + offset;
    const date = iso(ms);
    cells.push({ date, week: Math.floor(index / 7), weekday: index % 7, value: values.get(date) ?? 0 });
  }
  return cells;
}

export function CalendarHeatmap({ days, from, to, format, label }: CalendarHeatmapProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const cells = calendarCells(days, from, to);
  const extra = new Map(days.map((d) => [d.date, d.rows ?? []]));
  const max = Math.max(0, ...cells.map((c) => c.value));
  const weeks = (cells.at(-1)?.week ?? 0) + 1;
  const svgW = LEFT + weeks * (CELL + GAP);
  const svgH = TOP + 7 * (CELL + GAP);
  const starts = cells.filter((c) => c.date.endsWith('-01'));
  // The partial first month gets a label only when it has room before the next one.
  const first = cells[0];
  const months = first && !first.date.endsWith('-01') && (starts[0]?.week ?? Infinity) - first.week >= 3 ? [first, ...starts] : starts;
  const title = (d: string) => new Date(parse(d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

  return (
    <Frame label={label} frameRef={ref}>
      <div className={styles.scrollX}>
        <svg className={styles.svg} width={svgW} height={svgH} style={{ inlineSize: svgW }} role="img" aria-label={label} onPointerLeave={hide}>
          {months.map((c) => (
            <text key={c.date} className={styles.tick} x={LEFT + c.week * (CELL + GAP)} y={10}>
              {MONTHS[Number(c.date.slice(5, 7)) - 1]}
            </text>
          ))}
          {WEEKDAYS.map((w, i) =>
            w ? (
              <text key={w} className={styles.tick} x={0} y={TOP + i * (CELL + GAP) + CELL - 2}>
                {w}
              </text>
            ) : null,
          )}
          {cells.map((c) => {
            const cx = LEFT + c.week * (CELL + GAP);
            const cy = TOP + c.weekday * (CELL + GAP);
            const open = () =>
              show({
                x: Math.min(cx + CELL, width),
                y: cy + CELL / 2,
                title: title(c.date),
                rows: [{ label: 'tracked', value: c.value ? format(c.value) : 'nothing' }, ...(extra.get(c.date) ?? [])],
              });
            return (
              <rect
                key={c.date}
                className={`${styles.mark} ${styles.cell}`}
                x={cx}
                y={cy}
                width={CELL}
                height={CELL}
                rx={2}
                fill={sequential(level(c.value, max))}
                tabIndex={c.value ? 0 : -1}
                aria-label={`${title(c.date)}: ${c.value ? format(c.value) : 'nothing'}`}
                onPointerEnter={open}
                onFocus={open}
                onBlur={hide}
              />
            );
          })}
        </svg>
      </div>
      <p className={styles.legend} aria-hidden="true">
        Less
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => (
          <span key={t} className={styles.swatch} style={{ background: sequential(t), inlineSize: CELL, blockSize: CELL }} />
        ))}
        More
      </p>
      <Tooltip tip={tip} width={Math.max(width, svgW)} />
    </Frame>
  );
}

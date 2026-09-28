/**
 * When you read: seven weekday rows by twenty-four hour columns, each cell shaded by the
 * time in it. Scrolls sideways on narrow screens rather than shrinking the cells.
 */
import { level, sequential, useWidth } from './chart';
import { Frame, Tooltip, useTooltip } from './Tooltip';
import styles from './Charts.module.css';

export interface PunchCardProps {
  cells: readonly { weekday: number; hour: number; seconds: number }[];
  format: (seconds: number) => string;
  label: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const LEFT = 36;
const TOP = 18;
const GAP = 2;

export function PunchCard({ cells, format, label }: PunchCardProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const cell = Math.max(14, Math.min(28, Math.floor((width - LEFT) / 24) - GAP));
  const grid = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c.seconds]));
  const max = Math.max(0, ...cells.map((c) => c.seconds));
  const svgW = LEFT + 24 * (cell + GAP);
  const svgH = TOP + 7 * (cell + GAP);
  const byHour = Array.from({ length: 24 }, (_, h) => cells.filter((c) => c.hour === h).reduce((s, c) => s + c.seconds, 0));
  const byDay = DAYS.map((_, d) => cells.filter((c) => c.weekday === d).reduce((s, c) => s + c.seconds, 0));

  return (
    <Frame label={label} frameRef={ref}>
      <div className={styles.scrollX}>
        <svg className={styles.svg} width={svgW} height={svgH} style={{ inlineSize: svgW }} role="img" aria-label={label} onPointerLeave={hide}>
          {[0, 6, 12, 18].map((h) => (
            <text key={h} className={styles.tick} x={LEFT + h * (cell + GAP)} y={11}>
              {String(h).padStart(2, '0')}:00
            </text>
          ))}
          {DAYS.map((d, w) => (
            <g key={d}>
              <text className={styles.tick} x={0} y={TOP + w * (cell + GAP) + cell / 2} dy="0.32em">
                {d.slice(0, 3)}
              </text>
              {Array.from({ length: 24 }, (_, h) => {
                const seconds = grid.get(`${w}:${h}`) ?? 0;
                const x = LEFT + h * (cell + GAP);
                const y = TOP + w * (cell + GAP);
                const open = () =>
                  show({
                    x: x + cell,
                    y: y + cell / 2,
                    title: `${d}s, ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`,
                    rows: [
                      { label: 'in this hour', value: seconds ? format(seconds) : 'nothing' },
                      { label: `all ${d}s`, value: format(byDay[w] ?? 0) },
                      { label: `this hour, any day`, value: format(byHour[h] ?? 0) },
                    ],
                  });
                return (
                  <rect
                    key={h}
                    className={`${styles.mark} ${styles.cell}`}
                    x={x}
                    y={y}
                    width={cell}
                    height={cell}
                    rx={3}
                    fill={sequential(level(seconds, max))}
                    tabIndex={seconds ? 0 : -1}
                    aria-label={`${d} ${h}:00: ${seconds ? format(seconds) : 'nothing'}`}
                    onPointerEnter={open}
                    onFocus={open}
                    onBlur={hide}
                  />
                );
              })}
            </g>
          ))}
        </svg>
      </div>
      <Tooltip tip={tip} width={Math.max(width, svgW)} />
    </Frame>
  );
}

/**
 * Where the time goes: its split by surface, time per day or week, and the calendar of
 * active days. One island: every chart here shares the same window.
 */
import type { ReaderStats } from '../../lib/api/types/readerStats';
import { CalendarHeatmap } from '../charts/CalendarHeatmap';
import { ShareBar } from '../charts/ShareBar';
import { StackedColumns } from '../charts/StackedColumns';
import { formatPercent, formatTick, formatTime, plural, timeTicks } from './format';
import { addDays, dayTotal, SURFACES, surfacesIn, timeColumns, viewRange } from './model';
import { Panel } from './Panel';
import styles from './You.module.css';

type Props = Pick<ReaderStats, 'generated_at' | 'tz' | 'days' | 'daily' | 'surfaces'>;

export function TimeSection(stats: Props) {
  const { from, to } = viewRange(stats);
  const calendarFrom = stats.days && stats.days <= 365 ? from : addDays(to, -364);
  const shares = SURFACES.map((s) => ({ ...s, value: stats.surfaces.find((x) => x.surface === s.key)?.seconds ?? 0 }));
  const series = surfacesIn(...stats.daily.map((d) => d.seconds));
  return (
    <div className={styles.grid}>
      <Panel title="Where your time goes" lede="Every tracked second by what you were doing." wide>
        <ShareBar parts={shares} label="Time by surface" format={(v, share) => `${formatTime(v)} · ${formatPercent(share)}`} />
      </Panel>
      <Panel title="Day by day" lede="Tracked time per day, or per week over longer spans; hover a column for its breakdown." wide>
        <StackedColumns columns={timeColumns(stats.daily, from, to)} series={series.length ? series : SURFACES.slice(0, 1)} format={formatTime} tickFormat={formatTick} ticks={timeTicks} label="Time per period by surface" />
      </Panel>
      <Panel title="Your reading year" lede="Each square a day, darker for more time. Notes, recalls and reviews show in the tooltip." wide>
        <CalendarHeatmap
          from={calendarFrom}
          to={to}
          format={formatTime}
          label="Tracked time per day over the last year"
          days={stats.daily.map((d) => ({
            date: d.date,
            value: dayTotal(d),
            rows: [
              ...(d.notes ? [{ label: 'notes', value: String(d.notes) }] : []),
              ...(d.recalls ? [{ label: 'recalls', value: String(d.recalls) }] : []),
              ...(d.reviews ? [{ label: 'reviews', value: plural(d.reviews, 'card') }] : []),
              ...(d.moves ? [{ label: 'moved your place', value: plural(d.moves, 'chapter') }] : []),
            ],
          }))}
        />
      </Panel>
    </div>
  );
}

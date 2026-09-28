/** When and how long you read: the week's hours, how long sittings last, and the last two weeks. */
import type { ReaderStats } from '../../lib/api/types/readerStats';
import { PunchCard } from '../charts/PunchCard';
import { SessionStrip } from '../charts/SessionStrip';
import { StackedColumns } from '../charts/StackedColumns';
import { formatCount, formatTime } from './format';
import { localDay, SURFACES, sittings } from './model';
import { Figures, Panel } from './Panel';
import styles from './You.module.css';

type Props = Pick<ReaderStats, 'generated_at' | 'tz' | 'hours' | 'session_lengths' | 'sessions' | 'totals'> & { titles: Record<string, string> };

export function RhythmSection({ generated_at, tz, hours, session_lengths, sessions, totals, titles }: Props) {
  const strip = sittings(sessions, tz, localDay(generated_at, tz), 14, formatTime, titles);
  const bins = session_lengths.map((b) => ({ key: b.label, label: b.label, values: { sittings: b.count } }));
  return (
    <div className={styles.grid}>
      <Panel title="When you read" lede={`Tracked time by weekday and hour, in ${tz}.`} wide>
        <PunchCard cells={hours} format={formatTime} label="Tracked time by weekday and hour" />
      </Panel>
      <Panel title="How long you sit" lede="A sitting is time with no break longer than ten minutes, on any surface.">
        <Figures
          items={[
            { label: 'Sittings', value: formatCount(totals.sessions) },
            { label: 'Typical', value: formatTime(totals.median_session_seconds) },
            { label: 'Longest', value: formatTime(totals.longest_session_seconds) },
          ]}
        />
        <StackedColumns columns={bins} series={[{ key: 'sittings', label: 'Sittings', color: 'var(--series-1)' }]} format={(v) => formatCount(v)} label="Sittings by length" capLabels height={180} />
      </Panel>
      <Panel title="The last two weeks" lede="Each sitting from its start to its end, colored by what it was mostly spent on.">
        <SessionStrip days={strip.days} sittings={strip.sittings} series={SURFACES} label="Sittings over the last 14 days" />
      </Panel>
    </div>
  );
}

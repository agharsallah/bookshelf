/**
 * Remembering it: recall scores over time, which key ideas stayed, how reviews went, and
 * the cards coming due.
 */
import type { MemoryStats, ReaderStats } from '../../lib/api/types/readerStats';
import { LineChart } from '../charts/LineChart';
import { ShareBar } from '../charts/ShareBar';
import { StackedColumns } from '../charts/StackedColumns';
import { formatCount, formatPercent, NONE, plural } from './format';
import { countColumns, viewRange } from './model';
import { Figures, Panel } from './Panel';
import styles from './You.module.css';

type Props = { memory: MemoryStats } & Pick<ReaderStats, 'daily' | 'generated_at' | 'tz' | 'days'>;

const IDEAS: Record<string, { label: string; color: string }> = {
  recalled: { label: 'Recalled', color: 'var(--series-4)' },
  partial: { label: 'Half recalled', color: 'var(--series-2)' },
  missed: { label: 'Missed', color: 'var(--series-6)' },
};
const RATINGS: Record<string, string> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
const count = (v: number) => formatCount(v);

export function MemorySection({ memory, ...stats }: Props) {
  const { from, to } = viewRange(stats);
  const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <div className={styles.grid}>
      <Panel title="Recall over time" lede="Each graded recall: key ideas recalled, plus half the ones half recalled.">
        <Figures
          items={[
            { label: 'Recalls', value: count(memory.recalls) },
            { label: 'Graded', value: count(memory.graded) },
            { label: 'Predictions', value: count(memory.predictions) },
          ]}
        />
        <LineChart
          points={memory.trend.map((p) => ({
            at: new Date(p.at),
            value: p.score,
            title: p.chapter,
            rows: [
              { label: 'recalled', value: String(p.recalled) },
              { label: 'half', value: String(p.partial) },
              { label: 'missed', value: String(p.missed) },
            ],
          }))}
          domain={[0, 1]}
          format={(v) => formatPercent(v)}
          label="Recall score"
          color="var(--series-4)"
        />
        <ShareBar parts={memory.ideas.map((c) => ({ key: c.key, label: IDEAS[c.key]?.label ?? c.key, color: IDEAS[c.key]?.color ?? 'var(--series-other)', value: c.count }))} label="Key ideas by recall" format={(v, s) => `${count(v)} · ${formatPercent(s)}`} />
      </Panel>
      <Panel title="Reviews" lede={`How you rated ${plural(memory.reviews, 'review')}; Again means it was gone.`}>
        <Figures
          items={[
            { label: 'Remembered', value: formatPercent(memory.retention) },
            { label: 'Cards', value: count(memory.cards) },
            { label: 'Due now', value: count(memory.due_now) },
            { label: 'Mean stability', value: memory.mean_stability_days ? `${memory.mean_stability_days} days` : NONE },
          ]}
        />
        <StackedColumns
          columns={memory.ratings.map((r) => ({ key: r.key, label: RATINGS[r.key] ?? r.key, values: { reviews: r.count } }))}
          series={[{ key: 'reviews', label: 'Reviews', color: 'var(--series-5)' }]}
          format={count}
          label="Reviews by rating"
          capLabels
          height={160}
        />
        <ShareBar parts={memory.card_states.map((c, i) => ({ key: c.key, label: c.key, color: `var(--series-${i + 1})`, value: c.count }))} label="Cards by state" format={(v, s) => `${count(v)} · ${formatPercent(s)}`} />
      </Panel>
      <Panel title="Coming due" lede="Cards due each of the next fourteen days.">
        <StackedColumns
          columns={memory.due.map((d) => ({ key: d.date, label: short(d.date), values: { due: d.count } }))}
          series={[{ key: 'due', label: 'Cards due', color: 'var(--series-5)' }]}
          format={count}
          label="Cards due over the next 14 days"
          capLabels
          height={160}
        />
      </Panel>
      <Panel title="Reviews per day">
        <StackedColumns columns={countColumns(stats.daily, 'reviews', from, to)} series={[{ key: 'reviews', label: 'Reviews', color: 'var(--series-5)' }]} format={count} label="Reviews per period" height={160} />
      </Panel>
    </div>
  );
}

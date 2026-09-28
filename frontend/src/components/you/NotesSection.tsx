/** Your notes: how many and how long, their colors, what they mark, and when you write them. */
import type { ReaderStats } from '../../lib/api/types/readerStats';
import { ShareBar } from '../charts/ShareBar';
import { StackedColumns } from '../charts/StackedColumns';
import { formatCount, formatPercent, NONE } from './format';
import { countColumns, NOTE_COLORS, viewRange } from './model';
import { Figures, Panel } from './Panel';
import styles from './You.module.css';

type Props = Pick<ReaderStats, 'notes' | 'daily' | 'generated_at' | 'tz' | 'days'>;

const TARGETS: Record<string, string> = { source: 'The book’s text', chapter_distillation: 'Distillations', chapter_summary: 'Summaries' };
const count = (v: number) => formatCount(v);

export function NotesSection(stats: Props) {
  const { notes } = stats;
  const { from, to } = viewRange(stats);
  const colorParts = notes.by_color.map((c, i) => ({ key: c.key, label: c.key === 'none' ? 'No color' : c.key, color: NOTE_COLORS[c.key] ?? `var(--series-${(i % 6) + 1})`, value: c.count }));
  const targetParts = notes.by_target.map((c, i) => ({ key: c.key, label: TARGETS[c.key] ?? c.key, color: `var(--series-${i + 1})`, value: c.count }));
  const single = [{ key: 'notes', label: 'Notes and highlights', color: 'var(--series-3)' }];
  return (
    <div className={styles.grid}>
      <Panel title="What you write" lede="Notes carry your words; highlights only mark the passage.">
        <Figures
          items={[
            { label: 'Notes', value: count(notes.notes) },
            { label: 'Highlights', value: count(notes.highlights) },
            { label: 'Words', value: count(notes.words) },
            { label: 'Words per note', value: notes.mean_words ? String(Math.round(notes.mean_words)) : NONE },
            { label: 'Finished chapters without a note', value: count(notes.chapters_without_notes) },
          ]}
        />
        <ShareBar parts={colorParts} label="Notes by color" format={(v, s) => `${count(v)} · ${formatPercent(s)}`} />
        <ShareBar parts={targetParts} label="What notes mark" format={(v, s) => `${count(v)} · ${formatPercent(s)}`} />
      </Panel>
      <Panel title="How long your notes are" lede="Words per note, highlights left out.">
        <StackedColumns
          columns={notes.length.map((b) => ({ key: b.label, label: b.label, title: `${b.label} words`, values: { notes: b.count } }))}
          series={[{ key: 'notes', label: 'Notes', color: 'var(--series-3)' }]}
          format={count}
          label="Notes by length"
          capLabels
          height={180}
        />
      </Panel>
      <Panel title="When you annotate" lede="Notes and highlights per day or week." wide>
        <StackedColumns columns={countColumns(stats.daily, 'notes', from, to)} series={single} format={count} label="Notes per period" height={160} />
      </Panel>
    </div>
  );
}

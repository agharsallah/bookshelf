/**
 * Chapters: where the time went across books (a treemap), how long each took against its
 * length (a scatter with your usual rate), and the ones that slowed you down most.
 */
import type { ChapterRow } from '../../lib/api/types/readerStats';
import { Scatter } from '../charts/Scatter';
import { StackedColumns } from '../charts/StackedColumns';
import { Treemap } from '../charts/Treemap';
import tableStyles from '../stats/Stats.module.css';
import { formatCount, formatPercent, formatTick, formatTime, NONE, timeTicks } from './format';
import { chapterPoints, readHref, treemapGroups } from './model';
import { Panel } from './Panel';
import styles from './You.module.css';

interface Props {
  chapters: readonly ChapterRow[];
  colors: Record<string, string>;
  wordsPerMinute: number | null;
  /** One book: its chapters in reading order as columns instead of a treemap. */
  single?: boolean;
}

const PARTS = [
  { key: 'read', label: 'Reading', color: 'var(--series-1)' },
  { key: 'listen', label: 'Listening', color: 'var(--series-2)' },
  { key: 'other', label: 'Study, recall, review', color: 'var(--series-3)' },
];

export function ChaptersSection({ chapters, colors, wordsPerMinute, single = false }: Props) {
  const slow = chapters.filter((c) => c.pace !== null).sort((a, b) => (b.pace ?? 0) - (a.pace ?? 0)).slice(0, 8);
  const ordered = [...chapters].sort((a, b) => a.position - b.position);
  return (
    <div className={styles.grid}>
      {single ? (
        <Panel title="Chapter by chapter" lede="Time on each chapter in reading order." wide>
          <StackedColumns
            columns={ordered.map((c, i) => ({ key: c.anchor, label: String(i + 1), title: c.title, values: { read: c.read_seconds, listen: c.listen_seconds, other: c.other_seconds } }))}
            series={PARTS}
            format={formatTime}
            tickFormat={formatTick}
            ticks={timeTicks}
            label="Time per chapter"
          />
        </Panel>
      ) : (
        <Panel title="Where the hours went" lede="Each tile a chapter, sized by its time and colored by its book." wide>
          <Treemap groups={treemapGroups(chapters, colors)} format={formatTime} label="Time by book and chapter" />
        </Panel>
      )}
      <Panel title="Length against time" lede="Words read across, minutes up; bigger dots have more notes. Dots above the line took longer than your usual pace.">
        <Scatter
          points={chapterPoints(chapters, colors)}
          xLabel="words read"
          yLabel="minutes"
          xFormat={(v) => formatCount(v)}
          yFormat={(v) => `${Math.round(v)}`}
          label="Chapters by words read and minutes spent"
          reference={wordsPerMinute ? { slope: 1 / wordsPerMinute, label: `your usual ${Math.round(wordsPerMinute)} wpm` } : undefined}
        />
      </Panel>
      <Panel title="Where you slowed down" lede="Your usual words per minute over the chapter's: 2× means it took twice as long per word.">
        {slow.length === 0 ? (
          <p className={styles.panelLede}>Pace shows once you have read through a few chapters.</p>
        ) : (
          <div className={tableStyles.scroll}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Chapter</th>
                  <th scope="col" className={tableStyles.num}>Pace</th>
                  <th scope="col" className={tableStyles.num}>wpm</th>
                  <th scope="col" className={tableStyles.num}>Days</th>
                  <th scope="col" className={tableStyles.num}>Recall</th>
                </tr>
              </thead>
              <tbody>
                {slow.map((c) => (
                  <tr key={`${c.document}:${c.anchor}`}>
                    <th scope="row" className={tableStyles.wrap}>
                      <a href={readHref(c.document, c.anchor)}>{c.title}</a>
                      <span className={tableStyles.sub}>{c.book_title}</span>
                    </th>
                    <td className={`${tableStyles.num} ${(c.pace ?? 0) >= 1.6 ? tableStyles.warn : ''}`}>{c.pace ? `${c.pace.toFixed(1)}×` : NONE}</td>
                    <td className={tableStyles.num}>{c.words_per_minute ? Math.round(c.words_per_minute) : NONE}</td>
                    <td className={tableStyles.num}>{c.visits}</td>
                    <td className={tableStyles.num}>{formatPercent(c.recall_score)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** Your books: time on each by surface, how deep you went with the shelf, and every book side by side. */
import type { LibraryReaderStats } from '../../lib/api/types/readerStats';
import { HBars } from '../charts/HBars';
import tableStyles from '../stats/Stats.module.css';
import { ago, formatCount, formatPercent, formatTime, NONE } from './format';
import { bookBars, DEPTH_LABELS, STATE_LABELS, surfacesIn } from './model';
import { Panel } from './Panel';
import styles from './You.module.css';

type Props = Pick<LibraryReaderStats, 'books' | 'depth' | 'generated_at'>;

export function BooksSection({ books, depth, generated_at }: Props) {
  const bars = bookBars(books, formatTime);
  const shelf = books.length;
  return (
    <div className={styles.grid}>
      <Panel title="Time per book" lede="Stacked by what you were doing. A book opens its own statistics.">
        <HBars rows={bars} series={surfacesIn(...books.map((b) => b.seconds))} format={formatTime} label="Time per book" empty="No time tracked on a book yet." />
      </Panel>
      <Panel title="How deep you go" lede={`Of the ${shelf} books on your shelf, how many reached each step.`}>
        <HBars
          rows={depth.map((d) => ({ key: d.depth, label: DEPTH_LABELS[d.depth], values: { books: d.books }, valueLabel: `${d.books} of ${shelf}` }))}
          series={[{ key: 'books', label: 'Books', color: 'var(--series-1)' }]}
          format={(v) => formatCount(v)}
          max={Math.max(1, shelf)}
          label="Books reaching each depth"
        />
      </Panel>
      <Panel title="Every book" wide>
        <div className={tableStyles.scroll}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th scope="col">Book</th>
                <th scope="col">Progress</th>
                <th scope="col" className={tableStyles.num}>Time</th>
                <th scope="col" className={tableStyles.num}>wpm</th>
                <th scope="col" className={tableStyles.num}>Notes</th>
                <th scope="col" className={tableStyles.num}>per 1k words</th>
                <th scope="col" className={tableStyles.num}>Recalls</th>
                <th scope="col" className={tableStyles.num}>Retention</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.slug}>
                  <th scope="row" className={tableStyles.wrap}>
                    <a href={`/you/${b.slug}`}>{b.title}</a>
                    <span className={tableStyles.sub}>
                      {STATE_LABELS[b.state]} · {b.chapters_finished} of {b.chapters} chapters
                    </span>
                  </th>
                  <td>
                    <span className={tableStyles.barCell}>
                      <span className={tableStyles.track}>
                        <span className={tableStyles.fill} style={{ inlineSize: `${b.progress * 100}%` }} />
                      </span>
                      <span className={tableStyles.num}>{formatPercent(b.progress)}</span>
                    </span>
                  </td>
                  <td className={tableStyles.num}>{b.total_seconds ? formatTime(b.total_seconds) : NONE}</td>
                  <td className={tableStyles.num}>{b.words_per_minute ? Math.round(b.words_per_minute) : NONE}</td>
                  <td className={tableStyles.num}>{b.notes + b.highlights}</td>
                  <td className={tableStyles.num}>{b.notes_per_1k_words ?? NONE}</td>
                  <td className={tableStyles.num}>{b.recalls}</td>
                  <td className={tableStyles.num}>{formatPercent(b.retention)}</td>
                  <td>{ago(b.last_seen, generated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}


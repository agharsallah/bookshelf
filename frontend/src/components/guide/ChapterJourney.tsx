/**
 * The book's shape. An arc strip (every chapter as a segment sized by its share of the
 * reading, coloured by its role) with a role legend, then one row per chapter: title,
 * role, what it contributes to the argument, and a bar of its reading time.
 * Server-rendered; hover and focus tips are CSS only.
 */
import type { CSSProperties } from 'react';
import type { Anchor } from '../../lib/contract';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import { ROLE_LABELS, durationLabel, roleColor, roleCounts, type ChapterRow, type Role } from './guide';
import styles from './Guide.module.css';

type Align = 'start' | 'center' | 'end';

/** Where a segment's tip opens, so tips near the strip's ends stay on the page. */
function alignments(rows: readonly ChapterRow[]): Align[] {
  let before = 0;
  return rows.map((row) => {
    const middle = before + row.weight / 2;
    before += row.weight;
    return middle < 0.25 ? 'start' : middle > 0.75 ? 'end' : 'center';
  });
}

const roleName = (role: Role | null) => (role ? ROLE_LABELS[role] : 'Not described');
const roleStyle = (role: Role | null) => ({ '--role': roleColor(role) }) as CSSProperties;

export interface ChapterJourneyProps {
  rows: readonly ChapterRow[];
  citeHref: (anchor: Anchor) => string;
}

export function ChapterJourney({ rows, citeHref }: ChapterJourneyProps) {
  const counts = roleCounts(rows);
  const unassigned = rows.filter((r) => r.role === null).length;
  const align = alignments(rows);
  return (
    <CiteProvider value={{ citeHref }}>
      <figure className={styles.arc}>
        <figcaption className={styles.arcCaption}>Each chapter's share of the reading, coloured by what it does for the argument</figcaption>
        <div className={styles.strip}>
          {rows.map((row, i) => (
            <a
              key={row.anchor}
              href={citeHref(row.anchor)}
              className={styles.segment}
              style={{ flexGrow: Math.max(row.weight, 0.001), ...roleStyle(row.role) }}
              data-tip={`${row.number}. ${row.heading} · ${roleName(row.role)} · ${durationLabel(row.minutes)}`}
              data-align={align[i]}
              aria-label={`Chapter ${row.number}, ${row.heading}: ${roleName(row.role)}, ${durationLabel(row.minutes)}`}
            />
          ))}
        </div>
        <ul className={styles.legend} aria-label="Chapter roles">
          {counts.map(({ role, count }) => (
            <li key={role} style={roleStyle(role)}>
              <span className={styles.swatch} aria-hidden="true" />
              {ROLE_LABELS[role]} <span className={styles.count}>{count}</span>
            </li>
          ))}
          {unassigned > 0 && (
            <li style={roleStyle(null)}>
              <span className={styles.swatch} aria-hidden="true" />
              Not described <span className={styles.count}>{unassigned}</span>
            </li>
          )}
        </ul>
      </figure>

      <ol className={styles.rows}>
        {rows.map((row) => (
          <li key={row.anchor} className={styles.row} style={roleStyle(row.role)}>
            <span className={styles.num} aria-hidden="true">
              {row.number}
            </span>
            <div className={styles.rowBody}>
              <p className={styles.rowTitle}>
                <a href={citeHref(row.anchor)}>{row.heading}</a>
                <span className={styles.role}>{roleName(row.role)}</span>
              </p>
              {row.takeaway.length > 0 && (
                <p className={styles.takeaway}>
                  <Spans spans={row.takeaway} />
                </p>
              )}
            </div>
            {row.minutes > 0 && (
              <div className={styles.time}>
                <span className={styles.track} aria-hidden="true">
                  <span className={styles.bar} style={{ inlineSize: `${Math.round(row.share * 100)}%` }} />
                </span>
                <span className={styles.minutes}>{durationLabel(row.minutes)}</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </CiteProvider>
  );
}

export default ChapterJourney;

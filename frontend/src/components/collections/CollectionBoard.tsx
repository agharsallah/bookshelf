/**
 * The reading path as a game board, for the playful tone: Start on the outside, one
 * square per member in reading order, the finish at the heart of the spiral. The track is
 * inked as far as you have read, and your pawn stands on the member up next. Picking a
 * square opens its card: how far you are, the note on what it adds, and the moves (read,
 * overview, mark read). When the notes name levels ("Foundations: …"), the squares wear one
 * colour per level, a flag marks where each begins, and a legend counts each level's reads. Shown and hidden by the tone on <html data-cheer>, so it renders on
 * the server with no flash; the list below stays for arranging.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { GENRE_LABELS } from '../../lib/api/types/documents';
import { burst } from '../cheer/burst';
import styles from './Board.module.css';
import { boardFor, levelAt, levelsOf, trackPoints, type BoardCell } from './board';
import type { PathEntry } from './CollectionPath';
import { MemberNote } from './MemberNote';
import { memberLabel, memberShare, readHref } from './path';

export interface CollectionBoardProps {
  collection: string;
  members: PathEntry[];
  /** The id of the member up next, where the pawn stands. */
  next: string | null;
  onFinished: (member: PathEntry, finished: boolean) => void;
  onNote: (id: string, note: string | null) => Promise<void>;
}

/** Level colours cycle through the chart series (Board.module.css). */
const LEVEL_DYES = 6;

/** Where the pawn stands: on the upper-right corner of its square. */
const place = (cell: BoardCell | undefined, cols: number, rows: number) =>
  cell ? { left: `${((cell.col + 0.8) / cols) * 100}%`, top: `${((cell.row + 0.42) / rows) * 100}%` } : undefined;

export function CollectionBoard({ collection, members, next, onFinished, onNote }: CollectionBoardProps) {
  const board = useMemo(() => boardFor(members.length + 2), [members.length]);
  const nextIndex = next ? members.findIndex((m) => m.id === next) : -1;
  const allRead = members.length > 0 && nextIndex < 0;
  /** The square the pawn stands on: Start when nothing is read, the finish when all is. */
  const pawn = allRead ? members.length + 1 : nextIndex + 1;
  const [picked, setPicked] = useState<string | null>(null);
  const shown = members.find((m) => m.id === picked) ?? members[nextIndex] ?? members.at(-1) ?? null;
  const shownIndex = shown ? members.indexOf(shown) : -1;
  const levels = useMemo(() => levelsOf(members.map((m) => ({ note: m.note, done: memberShare(m) >= 1 }))), [members]);
  const hereLevel = levelAt(levels, allRead ? members.length - 1 : nextIndex);
  const shownLevel = levelAt(levels, shownIndex);

  if (members.length === 0) return null;

  const { cols, rows, cells } = board;
  const inked = cells.slice(0, pawn + 1);

  const finish = (m: PathEntry, finished: boolean) => {
    onFinished(m, finished);
    if (finished) {
      setPicked(null);
      burst();
    }
  };

  return (
    <section className={styles.game} data-cheer-only="playful" aria-label="The collection as a board game">
      {levels.length > 0 && (
        <ol className={styles.levels} aria-label="Levels">
          {levels.map((l, k) => (
            <li
              key={l.first}
              data-level={k % LEVEL_DYES}
              data-here={k === hereLevel ? '' : undefined}
              data-cleared={l.done === l.count ? '' : undefined}
            >
              <span className={styles.levelNumber} aria-hidden="true">
                {l.done === l.count ? '✓' : k + 1}
              </span>
              <strong>{l.name}</strong>
              <span className={styles.levelCount}>
                {l.done}/{l.count}
                <span className="visually-hidden"> read</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className={styles.board}>
        <div
          className={styles.field}
          style={
            {
              '--cols': cols,
              aspectRatio: `${cols} / ${rows}`,
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridTemplateRows: `repeat(${rows}, 1fr)`,
            } as CSSProperties
          }
        >
          <svg className={styles.track} viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
            <polyline className={styles.ahead} points={trackPoints(cells)} />
            <polyline className={styles.behind} points={trackPoints(inked)} />
          </svg>

          <span className={styles.square} data-kind="start" style={{ gridRow: (cells[0]?.row ?? 0) + 1, gridColumn: (cells[0]?.col ?? 0) + 1 }}>
            Start
          </span>

          <ol className={styles.squares} aria-label="Squares">
            {members.map((m, i) => {
              const cell = cells[i + 1];
              const share = memberShare(m);
              const state = share >= 1 ? 'done' : m.id === next ? 'here' : share > 0 ? 'started' : 'ahead';
              const level = levelAt(levels, i);
              const opensLevel = level >= 0 && levels[level]?.first === i;
              return (
                <li key={m.id} style={{ gridRow: (cell?.row ?? 0) + 1, gridColumn: (cell?.col ?? 0) + 1 }}>
                  <button
                    type="button"
                    className={styles.square}
                    data-genre={m.genre}
                    data-state={state}
                    data-level={level >= 0 ? level % LEVEL_DYES : undefined}
                    aria-pressed={shown?.id === m.id}
                    aria-label={`Square ${i + 1}: ${m.title}, ${memberLabel(m).toLowerCase()}${opensLevel ? `, starts ${levels[level]?.name}` : ''}`}
                    title={m.title}
                    style={{ '--share': share } as CSSProperties}
                    onClick={() => setPicked(m.id)}
                  >
                    <span className={styles.number}>{i + 1}</span>
                    {(state === 'done' || opensLevel) && (
                      <span className={styles.glyph} aria-hidden="true">
                        {state === 'done' ? '✓' : '🚩'}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ol>

          <span
            className={styles.square}
            data-kind="finish"
            data-reached={allRead ? '' : undefined}
            style={{ gridRow: (cells.at(-1)?.row ?? 0) + 1, gridColumn: (cells.at(-1)?.col ?? 0) + 1 }}
          >
            🏆
          </span>

          <span className={styles.pawn} style={place(cells[pawn], cols, rows)} aria-hidden="true" />
        </div>
      </div>

      <p className={styles.status} aria-live="polite">
        {allRead
          ? `You made it to the finish: all ${members.length} read! 🎉`
          : `Square ${pawn} of ${members.length}${hereLevel >= 0 ? `, in ${levels[hereLevel]?.name} (level ${hereLevel + 1} of ${levels.length})` : ''}. ${members.length - pawn} to go after this one, then the trophy.`}
      </p>

      {shown && (
        <article className={styles.card} data-genre={shown.genre} data-level={shownLevel >= 0 ? shownLevel % LEVEL_DYES : undefined}>
          <span className={styles.cardNumber} aria-hidden="true">
            {shownIndex + 1}
          </span>
          <div className={styles.cardBody}>
            <p className={styles.cardKicker}>
              {GENRE_LABELS[shown.genre]}, square {shownIndex + 1} of {members.length}
              {shownLevel >= 0 && `, level ${shownLevel + 1}: ${levels[shownLevel]?.name}`}
              {shown.id === next && <span className={styles.yourMove}>Your move</span>}
            </p>
            <h3 className={styles.cardTitle}>
              <a href={readHref(shown.slug, collection, shown.resume)}>{shown.title}</a>
            </h3>
            {shown.authors.length > 0 && <p className={styles.cardAuthors}>{shown.authors.join(', ')}</p>}
            <div className={styles.adds}>
              <p className={styles.addsLabel}>What it adds</p>
              <MemberNote key={shown.id} note={shown.note} title={shown.title} onSave={(note) => onNote(shown.id, note)} />
            </div>
            <div className={styles.moves}>
              <span className={styles.meter} aria-hidden="true">
                <span style={{ inlineSize: `${Math.round(memberShare(shown) * 100)}%` }} />
              </span>
              <span>{memberLabel(shown)}</span>
              {memberShare(shown) < 1 && (
                <a className="btn btn-primary" href={readHref(shown.slug, collection, shown.resume)}>
                  {memberShare(shown) > 0 ? 'Keep reading' : 'Start reading'}
                </a>
              )}
              <a href={`/documents/${shown.slug}`}>Overview</a>
              {shown.finished ? (
                <button type="button" className={styles.link} onClick={() => finish(shown, false)}>
                  Step back: mark unread
                </button>
              ) : shown.read < 1 ? (
                <button type="button" className="btn" onClick={() => finish(shown, true)}>
                  {shown.id === next ? 'Mark read and move on' : 'Mark read'}
                </button>
              ) : null}
            </div>
          </div>
        </article>
      )}
    </section>
  );
}

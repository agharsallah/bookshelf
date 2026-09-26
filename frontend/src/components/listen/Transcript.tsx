/**
 * The script beside the audio: its parts (the player's chapters) and every turn, who says
 * it and where in the book it comes from. While it plays, the turn being spoken is marked
 * and kept in view (unless you scroll away or prefer reduced motion); click a part's title
 * or a turn's time to hear it from there. Turn times are estimates, part times exact.
 */
import { useEffect, useRef } from 'react';
import type { Mark } from '../../lib/api/types/audio';
import { CiteMarks } from '../blocks/CiteChip';
import { ReaderCites } from '../study/ReaderCites';
import { formatTime, markAt, type Script } from './listening';
import styles from './Listen.module.css';

export interface TranscriptProps {
  slug: string;
  script: Script;
  /** Speaker labels, speaker 1 first ("Host · Alice"). */
  speakers: readonly string[];
  /** The render's timeline, or null before there is audio. */
  sections: readonly Mark[] | null;
  turns: readonly Mark[] | null;
  time: number;
  onSeek: (seconds: number) => void;
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Transcript({ slug, script, speakers, sections, turns, time, onSeek }: TranscriptProps) {
  const playing = turns ? markAt(turns, time) : -1;
  const active = useRef<HTMLLIElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    const stop = () => (follow.current = false);
    window.addEventListener('wheel', stop, { passive: true });
    window.addEventListener('touchmove', stop, { passive: true });
    return () => {
      window.removeEventListener('wheel', stop);
      window.removeEventListener('touchmove', stop);
    };
  }, []);

  useEffect(() => {
    if (playing < 0 || !follow.current || !active.current?.scrollIntoView) return;
    active.current.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }, [playing]);

  const seek = (seconds: number) => {
    follow.current = true;
    onSeek(seconds);
  };

  let index = -1;
  return (
    <ReaderCites slug={slug}>
      <ol className={styles.transcript}>
        {script.sections.map((section, s) => {
          const part = sections?.[s];
          return (
            <li key={s} className={styles.part}>
              <h3 className={styles.partTitle}>
                {part ? (
                  <button type="button" className={styles.partSeek} onClick={() => seek(part.start)}>
                    <span className={styles.partTime}>{formatTime(part.start)}</span>
                    {section.title}
                  </button>
                ) : (
                  section.title
                )}
              </h3>
              <ol className={styles.turns}>
                {section.turns.map((turn, t) => {
                  index += 1;
                  const mark = turns?.[index];
                  const current = index === playing;
                  return (
                    <li
                      key={t}
                      ref={current ? active : undefined}
                      className={styles.turn}
                      data-speaker={turn.speaker}
                      aria-current={current ? 'true' : undefined}
                    >
                      <span className={styles.who}>
                        {speakers[turn.speaker] ?? `Speaker ${turn.speaker + 1}`}
                        {mark && (
                          <button type="button" className={styles.turnSeek} onClick={() => seek(mark.start)} aria-label={`Play from ${formatTime(mark.start)}`}>
                            {formatTime(mark.start)}
                          </button>
                        )}
                      </span>
                      <p className={styles.says}>
                        {turn.text}
                        <CiteMarks anchors={turn.cites} />
                      </p>
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ol>
    </ReaderCites>
  );
}

export default Transcript;

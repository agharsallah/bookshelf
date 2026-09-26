/**
 * The pieces of the flashcard deck: the card that turns over, the progress strip
 * across the pass, and the end-of-pass summary.
 */
import { useEffect, useRef } from 'react';
import { Spans } from '../blocks/Spans';
import type { Mark, Marks, Tally } from './deck';
import type { Flashcard } from './study-body';
import styles from './Flashcards.module.css';

const MARK_LABEL: Record<Mark, string> = { knew: 'You knew this', learning: 'Still learning' };

export interface CardProps {
  card: Flashcard;
  turned: boolean;
  mark: Mark | undefined;
  onTurn: () => void;
}

/**
 * Both faces share one grid cell, so the card is as tall as its longer face. The face
 * turned away is inert: not focusable, not read out.
 */
export function Card({ card, turned, mark, onTurn }: CardProps) {
  return (
    <div className={styles.scene}>
      <div className={styles.card} data-turned={turned ? '' : undefined}>
        <div className={`${styles.face} ${styles.front}`} inert={turned} onClick={onTurn}>
          <CardTop group={card.group} mark={mark} />
          <p className={styles.prompt}>{card.front}</p>
          <p className={styles.hint}>Think of the answer, then turn the card.</p>
        </div>
        <div className={`${styles.face} ${styles.back}`} inert={!turned}>
          <CardTop group={card.group} mark={mark} />
          <p className={styles.asked}>{card.front}</p>
          <p className={styles.answer}>
            <Spans spans={card.back} />
          </p>
        </div>
      </div>
    </div>
  );
}

function CardTop({ group, mark }: { group: string | null; mark: Mark | undefined }) {
  if (!group && !mark) return null;
  return (
    <p className={styles.cardTop}>
      <span>{group}</span>
      {mark ? (
        <span className={styles.badge} data-mark={mark}>
          {MARK_LABEL[mark]}
        </span>
      ) : null}
    </p>
  );
}

/** One segment per card of the pass: known, still learning, or not yet marked. */
export function Progress({ order, position, marks }: { order: readonly number[]; position: number; marks: Marks }) {
  return (
    <ol className={styles.progress} aria-hidden="true" data-dense={order.length > 40 ? '' : undefined}>
      {order.map((card, index) => (
        <li key={card} data-mark={marks[card]} data-current={index === position ? '' : undefined} data-seen={index < position ? '' : undefined} />
      ))}
    </ol>
  );
}

export interface SummaryProps {
  tally: Tally;
  missed: number;
  onMissed: () => void;
  onAgain: () => void;
  onForget: () => void;
}

export function Summary({ tally, missed, onMissed, onAgain, onForget }: SummaryProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const rest = [
    tally.learning > 0 ? `${tally.learning} still learning` : '',
    tally.unmarked > 0 ? `${tally.unmarked} not marked` : '',
  ].filter(Boolean);
  return (
    <div className={styles.summary}>
      <h2 ref={heading} tabIndex={-1} className={styles.summaryTitle}>
        End of the deck
      </h2>
      <p className={styles.result}>
        You knew{' '}
        <strong className={styles.stroke}>
          {tally.knew} of {tally.total}
        </strong>
      </p>
      {rest.length > 0 ? <p className={styles.rest}>{rest.join(', ')}.</p> : <p className={styles.rest}>Every card, known.</p>}
      <div className={styles.summaryActions}>
        {missed > 0 ? (
          <button type="button" className="btn btn-primary" onClick={onMissed}>
            Study the {missed === 1 ? 'one' : missed} I missed
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onAgain}>
          Go through all {tally.total} again
        </button>
        <button type="button" className="btn btn-quiet" onClick={onForget}>
          Clear my marks
        </button>
      </div>
    </div>
  );
}

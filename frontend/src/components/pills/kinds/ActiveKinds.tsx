/**
 * The kinds that ask something: a quiz answered in place with its cited explanation, a
 * flashcard that turns on a tap and asks whether you knew it, and a due review card run
 * through the existing review path (reveal, then rate 1–4, as on Today).
 */
import { useState } from 'react';
import type { Rating } from '../../../lib/api/types/recalls';
import { Spans } from '../../blocks/Spans';
import { problemOf } from '../../common/Problem';
import { rateReview } from '../../recall/api';
import type { KindProps } from './context';
import styles from './Kinds.module.css';

export function QuizPill({ pill, ctx }: KindProps<'quiz'>) {
  const [choice, setChoice] = useState<number | null>(null);
  const { question, choices, answer, explanation } = pill.body;
  const pick = (index: number) => {
    if (choice !== null) return;
    setChoice(index);
    ctx.onAnswer({ correct: index === answer, choice: index });
  };
  return (
    <div className={styles.quiz}>
      <p className={styles.question}>{question}</p>
      <ol className={styles.choices}>
        {choices.map((text, index) => {
          const state = choice === null ? undefined : index === answer ? 'right' : index === choice ? 'wrong' : 'other';
          return (
            <li key={index}>
              <button type="button" className={styles.choice} data-state={state} aria-pressed={choice === index} disabled={choice !== null && state === 'other'} onClick={() => pick(index)}>
                {text}
              </button>
            </li>
          );
        })}
      </ol>
      {choice !== null ? (
        <div className={styles.explanation} role="status">
          <strong>{choice === answer ? 'Right.' : 'Not quite.'}</strong>{' '}
          <Spans spans={explanation} />
        </div>
      ) : null}
    </div>
  );
}

export function FlipPill({ pill, ctx }: KindProps<'flip'>) {
  const [turned, setTurned] = useState(false);
  const [knew, setKnew] = useState<boolean | null>(null);
  const mark = (correct: boolean) => {
    if (knew !== null) return;
    setKnew(correct);
    ctx.onAnswer({ correct });
  };
  return (
    <div className={styles.flip}>
      <button type="button" className={styles.card} data-turned={turned ? '' : undefined} aria-expanded={turned} onClick={() => setTurned(true)}>
        <span className={styles.front}>{pill.body.front}</span>
        {turned ? null : <span className={styles.hint}>Tap to turn</span>}
      </button>
      {turned ? (
        <>
          <p className={styles.back}>
            <Spans spans={pill.body.back} />
          </p>
          {knew === null ? (
            <div className={styles.marks} role="group" aria-label="Did you know it?">
              <button type="button" className="btn" onClick={() => mark(false)}>
                Missed it
              </button>
              <button type="button" className="btn btn-primary" onClick={() => mark(true)}>
                Knew it
              </button>
            </div>
          ) : (
            <p className={styles.note} role="status">
              {knew ? 'Noted.' : 'It will come back for review.'}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

const RATINGS: readonly { rating: Rating; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];

export function ReviewPill({ pill, ctx }: KindProps<'review'>) {
  const [attempt, setAttempt] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [rated, setRated] = useState<Rating | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const itemId = pill.review_item_id;

  const rate = async (rating: Rating) => {
    if (!itemId || busy || rated !== null) return;
    setBusy(true);
    setError(null);
    try {
      await rateReview(ctx.reviewApi, itemId, rating, attempt.trim());
      setRated(rating);
      ctx.onAnswer({ correct: rating >= 3, rating });
    } catch (failure) {
      setError(`The review was not saved: ${problemOf(failure).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.review}>
      <p className={styles.question}>{pill.body.prompt}</p>
      <label className={styles.field}>
        <span className="visually-hidden">Your answer, from memory</span>
        <textarea value={attempt} readOnly={revealed} placeholder="Your answer, from memory" rows={2} maxLength={20000} onChange={(event) => setAttempt(event.target.value)} />
      </label>
      {revealed ? (
        <>
          <p className={styles.back}>
            <Spans spans={pill.body.answer} />
          </p>
          {rated === null ? (
            <div className={styles.marks} role="group" aria-label="How well did you know it?">
              {RATINGS.map(({ rating, label }) => (
                <button key={rating} type="button" className={rating === 3 ? 'btn btn-primary' : 'btn'} disabled={busy || !itemId} onClick={() => void rate(rating)}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className={styles.note} role="status">
              Rated {RATINGS.find((r) => r.rating === rated)?.label}.
            </p>
          )}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        // Like Due today: the review path logs what you recalled, so an attempt comes first.
        <button type="button" className="btn btn-primary" disabled={!attempt.trim()} onClick={() => setRevealed(true)}>
          Show the answer
        </button>
      )}
    </div>
  );
}

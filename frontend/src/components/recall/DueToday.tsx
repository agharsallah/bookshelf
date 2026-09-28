/**
 * Due today (island, on the Desk): the review items due across every book, one at a
 * time. Each is retrieval, not rereading: you see the prompt alone, type an answer, and
 * only then can the cited passage be revealed; your self-rating tells FSRS when it comes
 * back. Ctrl/⌘+Enter reveals; 1–4 rate once it is revealed. Renders nothing when nothing
 * is due.
 */
import { useAttention } from '../../lib/activity/useAttention';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { browserApi } from '../../lib/api/client';
import type { DueCard, DueCards, Rating, Revealed, ReviewSource } from '../../lib/api/types/recalls';
import { Spans } from '../blocks/Spans';
import { problemOf } from '../common/Problem';
import { toast } from '../document/toast';
import { Kbd, ReaderCites } from '../study/ReaderCites';
import { dueCards, rateReview, revealAnswer, type RecallApi } from './api';
import styles from './DueToday.module.css';

export interface DueTodayProps {
  initial: DueCards;
  api?: RecallApi;
}

const SOURCE_LABELS: Record<ReviewSource, string> = {
  recall: 'Missed in a recall',
  question: 'Why is it true?',
  flashcard: 'Flashcard',
};

const RATINGS: readonly { rating: Rating; label: string }[] = [
  { rating: 1, label: 'Again' },
  { rating: 2, label: 'Hard' },
  { rating: 3, label: 'Good' },
  { rating: 4, label: 'Easy' },
];

export function DueToday({ initial, api = browserApi }: DueTodayProps) {
  const [cards, setCards] = useState<DueCard[]>(initial.items);
  const [total, setTotal] = useState(initial.total);
  const [reviewed, setReviewed] = useState(0);
  const [attempt, setAttempt] = useState('');
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [busy, setBusy] = useState(false);
  useAttention(cards.length > 0 ? { surface: 'review' } : null);
  const good = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const card = cards[0] ?? null;

  useEffect(() => {
    if (revealed) good.current?.focus();
  }, [revealed]);

  if (initial.total === 0) return null;

  const reveal = async () => {
    if (!card || !attempt.trim()) return;
    setBusy(true);
    try {
      setRevealed(await revealAnswer(api, card.id, attempt));
    } catch (error) {
      toast(`The answer could not be shown: ${problemOf(error).message}`, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const rate = async (rating: Rating) => {
    if (!card || !revealed) return;
    setBusy(true);
    try {
      await rateReview(api, card.id, rating, attempt);
      const rest = cards.slice(1);
      setReviewed((n) => n + 1);
      setAttempt('');
      setRevealed(null);
      setTotal((t) => Math.max(0, t - 1));
      // The first page ran out but more are due: fetch the next.
      setCards(rest.length === 0 && total > 1 ? (await dueCards(api)).items : rest);
      requestAnimationFrame(() => field.current?.focus());
    } catch (error) {
      toast(`The review was not saved: ${problemOf(error).message}`, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !revealed) {
      event.preventDefault();
      void reveal();
    }
    const choice = revealed && !busy ? RATINGS.find((r) => String(r.rating) === event.key) : undefined;
    if (choice && !(event.target instanceof HTMLTextAreaElement && !event.target.readOnly)) {
      event.preventDefault();
      void rate(choice.rating);
    }
  };

  return (
    <section className={styles.due} aria-labelledby="due-title" onKeyDown={onKey}>
      <div className={styles.head}>
        <h2 id="due-title" className={`section-title ${styles.title}`}>
          Due today
        </h2>
        <span className={styles.count}>{card ? `${total} to review` : `${reviewed} reviewed`}</span>
      </div>
      {card ? (
        <ReaderCites slug={card.document.slug}>
          <article className={styles.card} aria-label="Review card">
            <p className={styles.meta}>
              <span>{SOURCE_LABELS[card.source]}</span>
              <a href={`/documents/${card.document.slug}`}>{card.document.title}</a>
            </p>
            <p className={styles.prompt}>{card.prompt}</p>
            <label className={styles.field}>
              Your answer, from memory
              <textarea ref={field} value={attempt} readOnly={revealed !== null} onChange={(event) => setAttempt(event.target.value)} maxLength={20000} />
            </label>
            {revealed ? (
              <>
                <p className={styles.answer}>
                  <Spans spans={revealed.answer} />
                </p>
                <p className={styles.ask}>How well did you know it?</p>
                <div className={styles.actions}>
                  {RATINGS.map(({ rating, label }) => (
                    <button
                      key={rating}
                      ref={rating === 3 ? good : undefined}
                      type="button"
                      className={rating === 3 ? 'btn btn-primary' : 'btn'}
                      disabled={busy}
                      aria-keyshortcuts={String(rating)}
                      onClick={() => void rate(rating)}
                    >
                      {label} <Kbd>{rating}</Kbd>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.actions}>
                <button type="button" className="btn btn-primary" disabled={!attempt.trim() || busy} onClick={() => void reveal()}>
                  Reveal the answer <Kbd>⌘↵</Kbd>
                </button>
              </div>
            )}
          </article>
        </ReaderCites>
      ) : (
        <p className={styles.done} role="status">
          All done for today. What you reviewed comes back when it is due.
        </p>
      )}
    </section>
  );
}

export default DueToday;

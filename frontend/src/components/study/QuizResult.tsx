/** The end of a quiz round: the score, a new round to take, and the questions you missed. */
import { useEffect, useRef } from 'react';
import { Spans } from '../blocks/Spans';
import type { QuizState, Score } from './quiz-round';
import type { QuizQuestion } from './study-body';
import styles from './Quiz.module.css';

export interface QuizResultProps {
  questions: readonly QuizQuestion[];
  state: QuizState;
  score: Score;
  onRetry: (order: readonly number[]) => void;
  onAgain: () => void;
}

function verdictOf({ right, total }: Score): string {
  if (right === total) return 'Every one right.';
  if (right >= total * 0.8) return 'Nearly all of it. Look over the ones you missed below.';
  if (right >= total * 0.5) return 'A good start. The explanations below say where each answer comes from.';
  return 'Worth another look. Each explanation below links to the passage it comes from.';
}

export function QuizResult({ questions, state, score, onRetry, onAgain }: QuizResultProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const missed = score.missed.length;
  return (
    <div className={styles.result}>
      <div className={styles.scoreCard}>
        <h2 ref={heading} tabIndex={-1} className={styles.resultTitle}>
          Your score
        </h2>
        <p className={styles.score}>
          <strong className={styles.stroke}>
            {score.right} of {score.total}
          </strong>
        </p>
        <p className={styles.resultNote}>{verdictOf(score)}</p>
        <div className={styles.resultActions}>
          {missed > 0 && missed < score.total ? (
            <button type="button" className="btn btn-primary" onClick={() => onRetry(score.missed)}>
              Retry the {missed === 1 ? 'one' : missed} I missed
            </button>
          ) : null}
          <button type="button" className={missed === score.total ? 'btn btn-primary' : 'btn'} onClick={onAgain}>
            Try again
          </button>
        </div>
      </div>

      {missed > 0 ? (
        <section className={styles.missed} aria-labelledby="quiz-missed">
          <h3 id="quiz-missed">What you missed</h3>
          <ol>
            {score.missed.map((q) => {
              const question = questions[q];
              if (!question) return null;
              const pick = state.picks[q] ?? -1;
              return (
                <li key={q} className={styles.missedItem}>
                  <p className={styles.missedQuestion}>{question.question}</p>
                  <p className={styles.missedPick}>
                    <span className={styles.label}>You chose</span> <s>{question.choices[pick]}</s>
                  </p>
                  <p className={styles.missedAnswer}>
                    <span className={styles.label}>The answer</span> <mark className={styles.rightAnswer}>{question.choices[question.answer]}</mark>
                  </p>
                  {question.explanation.length > 0 ? (
                    <p className={styles.explanation}>
                      <Spans spans={question.explanation} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The quiz (island): one question at a time. Choosing an answer locks it in and shows
 * the right one (highlighted), your wrong pick if any, and the cited explanation; the
 * answer is never shown before you choose. The round ends on your score, with the
 * questions you missed to look over and a new round to take.
 *
 * Keys: 1–5 choose, Enter goes to the next question.
 */
import { useEffect, useReducer, useRef } from 'react';
import { Spans } from '../blocks/Spans';
import { shortcutApplies } from './keys';
import { QuizResult } from './QuizResult';
import { allQuestions, currentPick, currentQuestion, isOver, outcomeOf, quizReducer, scoreOf, startQuiz, type QuizState } from './quiz-round';
import { Kbd, ReaderCites } from './ReaderCites';
import type { QuizQuestion } from './study-body';
import styles from './Quiz.module.css';
import shared from './Study.module.css';

export interface QuizProps {
  slug: string;
  questions: QuizQuestion[];
}

export function Quiz({ slug, questions }: QuizProps) {
  const [state, dispatch] = useReducer(quizReducer, questions.length, (n) => startQuiz(allQuestions(n)));
  const heading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const index = currentQuestion(state);
  const question = index === null ? null : questions[index];
  const pick = currentPick(state);
  const over = isOver(state);
  const firstRender = useRef(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutApplies(event) || !question) return;
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= question.choices.length && pick === null) {
        event.preventDefault();
        dispatch({ type: 'choose', choice: digit - 1 });
      } else if (event.key === 'Enter' && pick !== null) {
        event.preventDefault();
        dispatch({ type: 'next' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [question, pick]);

  // A new question takes focus so it is read out; a pick hands focus to "Next".
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (pick === null) heading.current?.focus();
    else nextButton.current?.focus();
  }, [state.position, pick]);

  const last = state.position === state.order.length - 1;

  return (
    <ReaderCites slug={slug}>
      <section className={styles.quiz} aria-label="Quiz">
        <div className={shared.toolbar}>
          <Dots state={state} questions={questions} />
          <span className={shared.spacer} />
          <span className={shared.count}>{over ? `${state.order.length} questions` : `Question ${state.position + 1} of ${state.order.length}`}</span>
        </div>

        {question && index !== null ? (
          <>
            <div className={styles.sheet} key={`${index}@${state.position}`}>
              <h2 ref={heading} tabIndex={-1} className={styles.question}>
                {question.question}
              </h2>
              <ol className={styles.choices}>
                {question.choices.map((choice, i) => {
                  const verdict = pick === null ? undefined : i === question.answer ? 'right' : i === pick ? 'wrong' : 'other';
                  return (
                    <li key={i}>
                      <button
                        type="button"
                        className={styles.choice}
                        data-verdict={verdict}
                        disabled={pick !== null}
                        aria-keyshortcuts={String(i + 1)}
                        onClick={() => dispatch({ type: 'choose', choice: i })}
                      >
                        <span className={styles.key} aria-hidden="true">
                          {i + 1}
                        </span>
                        <span className={styles.choiceText}>
                          <span>{choice}</span>
                          {verdict === 'right' ? <span className={styles.tag}>{i === pick ? 'Your answer, correct' : 'Correct answer'}</span> : null}
                          {verdict === 'wrong' ? <span className={styles.tag}>Your answer</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div aria-live="polite">
                {pick !== null ? (
                  <div className={styles.feedback} data-verdict={pick === question.answer ? 'right' : 'wrong'}>
                    <p className={styles.verdict}>{pick === question.answer ? 'Right.' : `Not quite. The answer is ${question.answer + 1}.`}</p>
                    {question.explanation.length > 0 ? (
                      <p className={styles.explanation}>
                        <Spans spans={question.explanation} />
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className={styles.controls}>
              {pick === null ? (
                <p className={styles.prompt}>
                  Choose an answer
                  <span className={shared.keyHint}>
                    , or press <Kbd>1</Kbd>–<Kbd>{question.choices.length}</Kbd>
                  </span>
                </p>
              ) : (
                <button ref={nextButton} type="button" className="btn btn-primary" aria-keyshortcuts="Enter" onClick={() => dispatch({ type: 'next' })}>
                  {last ? 'See your score' : 'Next question'} <Kbd>Enter</Kbd>
                </button>
              )}
            </div>
          </>
        ) : (
          <QuizResult
            questions={questions}
            state={state}
            score={scoreOf(state, questions)}
            onRetry={(order) => dispatch({ type: 'begin', order })}
            onAgain={() => dispatch({ type: 'begin', order: allQuestions(questions.length) })}
          />
        )}
      </section>
    </ReaderCites>
  );
}

/** One dot per question of the round: right, wrong, or still to come. */
function Dots({ state, questions }: { state: QuizState; questions: readonly QuizQuestion[] }) {
  return (
    <ol className={styles.dots} aria-hidden="true">
      {state.order.map((q, i) => (
        <li key={q} data-outcome={outcomeOf(state, q, questions)} data-current={i === state.position ? '' : undefined} />
      ))}
    </ol>
  );
}

export default Quiz;

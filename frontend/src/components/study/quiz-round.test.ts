import { describe, expect, it } from 'vitest';
import { allQuestions, currentPick, currentQuestion, isOver, outcomeOf, quizReducer, scoreOf, startQuiz, type QuizAction, type QuizState } from './quiz-round';

const run = (state: QuizState, ...actions: QuizAction[]) => actions.reduce(quizReducer, state);
const answers = [{ answer: 0 }, { answer: 2 }, { answer: 1 }];

describe('quizReducer', () => {
  it('locks in the first pick for a question', () => {
    const state = run(startQuiz(allQuestions(3)), { type: 'choose', choice: 1 }, { type: 'choose', choice: 0 });
    expect(currentPick(state)).toBe(1);
  });

  it('will not move on before you choose', () => {
    const state = startQuiz(allQuestions(3));
    expect(run(state, { type: 'next' })).toBe(state);
  });

  it('goes question by question and ends after the last', () => {
    let state = startQuiz([2, 0]);
    expect(currentQuestion(state)).toBe(2);
    state = run(state, { type: 'choose', choice: 1 }, { type: 'next' });
    expect(currentQuestion(state)).toBe(0);
    expect(currentPick(state)).toBeNull();
    state = run(state, { type: 'choose', choice: 0 }, { type: 'next' });
    expect(isOver(state)).toBe(true);
    expect(run(state, { type: 'choose', choice: 2 })).toBe(state);
  });

  it('a new round starts clean', () => {
    const state = run(startQuiz([0]), { type: 'choose', choice: 1 }, { type: 'next' }, { type: 'begin', order: [0, 1] });
    expect(state).toEqual({ order: [0, 1], position: 0, picks: {} });
  });
});

describe('scoring', () => {
  const played = run(
    startQuiz(allQuestions(3)),
    { type: 'choose', choice: 0 },
    { type: 'next' },
    { type: 'choose', choice: 1 },
    { type: 'next' },
    { type: 'choose', choice: 0 },
    { type: 'next' },
  );

  it('marks each question right or wrong, and open until picked', () => {
    expect(outcomeOf(played, 0, answers)).toBe('right');
    expect(outcomeOf(played, 1, answers)).toBe('wrong');
    expect(outcomeOf(startQuiz([0]), 0, answers)).toBe('open');
  });

  it('scores the round and lists the missed questions in order', () => {
    expect(scoreOf(played, answers)).toEqual({ right: 1, total: 3, missed: [1, 2] });
  });

  it('a retry round scores only its own questions', () => {
    const retry = run(played, { type: 'begin', order: [1, 2] }, { type: 'choose', choice: 2 }, { type: 'next' }, { type: 'choose', choice: 1 }, { type: 'next' });
    expect(scoreOf(retry, answers)).toEqual({ right: 2, total: 2, missed: [] });
  });
});

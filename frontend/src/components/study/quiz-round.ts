/**
 * The quiz as plain state: one question at a time, a pick per question that cannot be
 * changed once made (the answer shows only after it), and a score at the end. A new
 * round (`begin`) can go through every question again or only the ones you missed.
 */

export interface QuizState {
  /** Question indexes in this round. */
  order: readonly number[];
  /** Index into `order`; equal to its length once the round is over. */
  position: number;
  /** Question index → the choice picked, this round. */
  picks: Readonly<Record<number, number>>;
}

export type QuizAction = { type: 'choose'; choice: number } | { type: 'next' } | { type: 'begin'; order: readonly number[] };

export function startQuiz(order: readonly number[]): QuizState {
  return { order, position: 0, picks: {} };
}

export function allQuestions(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

export function currentQuestion(state: QuizState): number | null {
  return state.order[state.position] ?? null;
}

export function isOver(state: QuizState): boolean {
  return state.position >= state.order.length;
}

/** The pick for the question in view, or null while you have not chosen. */
export function currentPick(state: QuizState): number | null {
  const question = currentQuestion(state);
  return question === null ? null : (state.picks[question] ?? null);
}

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  switch (action.type) {
    case 'choose': {
      const question = currentQuestion(state);
      if (question === null || state.picks[question] !== undefined) return state;
      return { ...state, picks: { ...state.picks, [question]: action.choice } };
    }
    case 'next':
      return currentPick(state) === null ? state : { ...state, position: state.position + 1 };
    case 'begin':
      return startQuiz(action.order);
  }
}

export type Outcome = 'right' | 'wrong' | 'open';

/** How one question of the round went. */
export function outcomeOf(state: QuizState, question: number, answers: readonly { answer: number }[]): Outcome {
  const pick = state.picks[question];
  if (pick === undefined) return 'open';
  return pick === answers[question]?.answer ? 'right' : 'wrong';
}

export interface Score {
  right: number;
  total: number;
  /** Questions answered wrongly this round, in round order. */
  missed: number[];
}

export function scoreOf(state: QuizState, answers: readonly { answer: number }[]): Score {
  const missed = state.order.filter((q) => outcomeOf(state, q, answers) === 'wrong');
  const right = state.order.filter((q) => outcomeOf(state, q, answers) === 'right').length;
  return { right, total: state.order.length, missed };
}

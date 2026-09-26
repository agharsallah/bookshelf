/** Small study sets for tests (and the shape a real one takes). */
import type { Flashcard, QuizQuestion } from './study-body';

export const CARDS: Flashcard[] = [
  { front: 'What does a behavioral interview evaluate?', back: [{ text: 'Future performance, from past behaviour.', cites: ['ch02/p006'] }], group: 'Basics' },
  { front: 'What does CARL stand for?', back: [{ text: 'Context, action, result, learning.', cites: ['ch05/p003'] }], group: 'Stories' },
  { front: 'Why prepare a story bank?', back: [{ text: 'One story can answer many questions.', cites: ['ch07/p001'] }], group: 'Stories' },
];

export const QUESTIONS: QuizQuestion[] = [
  {
    question: 'What replaces STAR in the book?',
    choices: ['SOAR', 'CARL', 'PAR'],
    answer: 1,
    explanation: [{ text: 'CARL adds what you learned.', cites: ['ch05/p003'] }],
  },
  {
    question: 'Which interviewer type probes for detail?',
    choices: ['The Conversationalist', 'The Examiner', 'The Friend', 'The Recruiter'],
    answer: 1,
    explanation: [{ text: 'The Examiner digs into specifics.', cites: ['ch11/p004'] }],
  },
];

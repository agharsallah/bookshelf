/**
 * Finishing a pass, as a pure state machine. Pass 1 ends on three questions (what kind
 * of paper, what it contributes, whether it earns a second pass); the answers are saved
 * as a `prediction` through the recalls API, then the pass is marked done. Passes 2
 * and 3 are marked done directly. A failed save keeps the answers for another try.
 *
 *   reading ──finish──▶ asking (pass 1) ──submit──▶ saving ──saved──▶ done
 *      │                                              │  ▲
 *      └────────finish (pass 2, 3)────────────────────┘  └─retry── failed
 */
import type { PassNumber } from '../../../lib/api/types/papers';

export const WORTH_OPTIONS = ['yes', 'maybe', 'no'] as const;
export type Worth = (typeof WORTH_OPTIONS)[number];

export const WORTH_LABELS: Record<Worth, string> = {
  yes: 'Yes, read it properly',
  maybe: 'Maybe, parts of it',
  no: 'No, this is enough',
};

/** Keshav's five Cs, trimmed to the kinds a skim can tell apart. */
export const CATEGORIES = ['method', 'empirical study', 'theory', 'system', 'survey', 'position', 'dataset or benchmark'] as const;

export interface SkimAnswers {
  category: string;
  contribution: string;
  worth: Worth | null;
}

export const NO_ANSWERS: SkimAnswers = { category: '', contribution: '', worth: null };

export type FlowState =
  | { step: 'reading' }
  | { step: 'asking'; answers: SkimAnswers }
  | { step: 'saving'; answers: SkimAnswers | null }
  | { step: 'failed'; answers: SkimAnswers | null; message: string }
  | { step: 'done' };

export type FlowEvent =
  | { type: 'finish' }
  | { type: 'answer'; answers: Partial<SkimAnswers> }
  | { type: 'submit' }
  | { type: 'saved' }
  | { type: 'failed'; message: string }
  | { type: 'retry' }
  | { type: 'cancel' };

/** Where a pass starts: done already, or still being read. */
export function initialFlow(done: boolean): FlowState {
  return done ? { step: 'done' } : { step: 'reading' };
}

export function canSubmit(answers: SkimAnswers): boolean {
  return answers.category.trim() !== '' && answers.contribution.trim() !== '' && answers.worth !== null;
}

export function flowReducer(pass: PassNumber, state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'finish':
      if (state.step === 'reading' || state.step === 'done') {
        return pass === 1 ? { step: 'asking', answers: NO_ANSWERS } : { step: 'saving', answers: null };
      }
      return state;
    case 'answer':
      // Editing after a failed save goes back to writing (the error is about the old text).
      if (state.step === 'asking' || (state.step === 'failed' && state.answers)) {
        return { step: 'asking', answers: { ...(state.answers ?? NO_ANSWERS), ...event.answers } };
      }
      return state;
    case 'submit':
      return state.step === 'asking' && canSubmit(state.answers) ? { step: 'saving', answers: state.answers } : state;
    case 'saved':
      return state.step === 'saving' ? { step: 'done' } : state;
    case 'failed':
      return state.step === 'saving' ? { step: 'failed', answers: state.answers, message: event.message } : state;
    case 'retry':
      return state.step === 'failed' ? { step: 'saving', answers: state.answers } : state;
    case 'cancel':
      return state.step === 'asking' || state.step === 'failed' ? { step: 'reading' } : state;
  }
}

/** The prediction's text: the three answers, one per line, readable on their own later. */
export function predictionText(answers: SkimAnswers): string {
  return [
    `Category: ${answers.category.trim()}`,
    `Main contribution: ${answers.contribution.trim()}`,
    `Worth a second pass: ${answers.worth ?? 'unsure'}`,
  ].join('\n');
}

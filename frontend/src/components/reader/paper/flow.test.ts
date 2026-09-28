import { describe, expect, it } from 'vitest';
import { canSubmit, flowReducer, initialFlow, predictionText, type FlowEvent, type FlowState } from './flow';

const run = (pass: 1 | 2 | 3, events: FlowEvent[], from: FlowState = initialFlow(false)) => events.reduce((s, e) => flowReducer(pass, s, e), from);
const answered: FlowEvent = { type: 'answer', answers: { category: 'method', contribution: 'Attention alone suffices.', worth: 'yes' } };

describe('finishing a pass', () => {
  it('asks the three skim questions before pass 1 is saved', () => {
    expect(run(1, [{ type: 'finish' }])).toMatchObject({ step: 'asking' });
    expect(run(1, [{ type: 'finish' }, { type: 'submit' }])).toMatchObject({ step: 'asking' }); // nothing answered yet
    const saving = run(1, [{ type: 'finish' }, answered, { type: 'submit' }]);
    expect(saving).toEqual({ step: 'saving', answers: { category: 'method', contribution: 'Attention alone suffices.', worth: 'yes' } });
    expect(flowReducer(1, saving, { type: 'saved' })).toEqual({ step: 'done' });
  });

  it('saves passes 2 and 3 straight away', () => {
    expect(run(2, [{ type: 'finish' }])).toEqual({ step: 'saving', answers: null });
    expect(run(3, [{ type: 'finish' }, { type: 'saved' }])).toEqual({ step: 'done' });
  });

  it('keeps the answers through a failed save, for a retry or an edit', () => {
    const failed = run(1, [{ type: 'finish' }, answered, { type: 'submit' }, { type: 'failed', message: 'offline' }]);
    expect(failed).toMatchObject({ step: 'failed', message: 'offline', answers: { worth: 'yes' } });
    expect(flowReducer(1, failed, { type: 'retry' })).toMatchObject({ step: 'saving', answers: { worth: 'yes' } });
    expect(flowReducer(1, failed, { type: 'answer', answers: { worth: 'maybe' } })).toMatchObject({ step: 'asking', answers: { category: 'method', worth: 'maybe' } });
  });

  it('can be put off while asking, and ignores events out of turn', () => {
    expect(run(1, [{ type: 'finish' }, { type: 'cancel' }])).toEqual({ step: 'reading' });
    expect(run(2, [{ type: 'saved' }])).toEqual({ step: 'reading' });
    expect(run(2, [{ type: 'retry' }, { type: 'submit' }])).toEqual({ step: 'reading' });
    expect(run(2, [{ type: 'finish' }, { type: 'finish' }])).toEqual({ step: 'saving', answers: null });
  });

  it('starts done when the pass is done, and can be marked again', () => {
    expect(initialFlow(true)).toEqual({ step: 'done' });
    expect(flowReducer(2, { step: 'done' }, { type: 'finish' })).toEqual({ step: 'saving', answers: null });
  });
});

describe('the skim answers', () => {
  it('need a category, a contribution and a verdict', () => {
    expect(canSubmit({ category: ' ', contribution: 'x', worth: 'no' })).toBe(false);
    expect(canSubmit({ category: 'theory', contribution: 'x', worth: null })).toBe(false);
    expect(canSubmit({ category: 'theory', contribution: 'x', worth: 'no' })).toBe(true);
  });

  it('read back as one line each in the prediction', () => {
    expect(predictionText({ category: ' method ', contribution: 'Attention alone suffices. ', worth: 'maybe' })).toBe(
      'Category: method\nMain contribution: Attention alone suffices.\nWorth a second pass: maybe',
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { PaperPassPublic } from '../../lib/api/types/papers';
import { rating } from './fixtures';
import { canSave, highestPass, initialRating, isChanged, passSteps, ratingBody, ratingReducer, withPass } from './rating';

describe('the rating form', () => {
  it('starts from the latest stars and verdict, with an empty note', () => {
    const state = initialRating([rating({ stars: 3, verdict: 'skim', note: 'old' }), rating({ id: 'r0', stars: 5 })]);
    expect(state).toMatchObject({ stars: 3, verdict: 'skim', note: '' });
    expect(canSave(state)).toBe(false);
  });

  it('needs stars before anything can be saved', () => {
    const empty = initialRating([]);
    expect(canSave(empty)).toBe(false);
    expect(canSave(ratingReducer(empty, { type: 'verdict', verdict: 'useful' }))).toBe(false);
    expect(ratingBody(ratingReducer(empty, { type: 'stars', stars: 4 }))).toEqual({ stars: 4, verdict: null });
  });

  it('clamps stars to one to five', () => {
    expect(ratingReducer(initialRating([]), { type: 'stars', stars: 9 }).stars).toBe(5);
    expect(ratingReducer(initialRating([]), { type: 'stars', stars: 0 }).stars).toBe(1);
  });

  it('clears the verdict when the chosen one is chosen again', () => {
    const state = ratingReducer(initialRating([]), { type: 'verdict', verdict: 'must_read' });
    expect(ratingReducer(state, { type: 'verdict', verdict: 'must_read' }).verdict).toBeNull();
    expect(ratingReducer(state, { type: 'verdict', verdict: 'skip' }).verdict).toBe('skip');
  });

  it('can save a note alone, trimmed, over an unchanged rating', () => {
    const state = ratingReducer(initialRating([rating()]), { type: 'note', note: '  Second read: holds up.  ' });
    expect(isChanged(state)).toBe(true);
    expect(ratingBody(state)).toEqual({ stars: 4, verdict: 'useful', note: 'Second read: holds up.' });
    expect(ratingBody(ratingReducer(state, { type: 'note', note: '   ' }))).toBeNull();
  });

  it('puts a saved rating on top of the history and starts over from it', () => {
    const saved = rating({ id: 'r2', stars: 2, verdict: 'skip', note: 'Weak baselines.' });
    const state = ratingReducer({ ...initialRating([rating()]), stars: 2, note: 'Weak baselines.' }, { type: 'saved', rating: saved });
    expect(state.history.map((r) => r.id)).toEqual(['r2', 'r1']);
    expect(state).toMatchObject({ stars: 2, verdict: 'skip', note: '' });
  });

  it('resets unsaved changes to the rating in force', () => {
    const changed = ratingReducer(initialRating([rating()]), { type: 'stars', stars: 1 });
    expect(ratingReducer(changed, { type: 'reset' })).toMatchObject({ stars: 4, note: '' });
  });
});

const done = (pass: 1 | 2 | 3, note: string | null = null): PaperPassPublic => ({
  document_id: 'd1',
  pass,
  completed_at: `2026-09-0${pass}T10:00:00Z`,
  note,
});

describe('passes', () => {
  it('lists the three passes in order, marking the ones done', () => {
    const steps = passSteps([done(2, 'Methods clear')]);
    expect(steps.map((s) => [s.pass, s.name, s.done])).toEqual([
      [1, 'Skim', false],
      [2, 'Read', true],
      [3, 'Re\u2011create', false],
    ]);
    expect(steps[1]?.note).toBe('Methods clear');
  });

  it('marks a pass done or undoes it, keeping pass order', () => {
    expect(withPass([done(3)], 1, done(1)).map((p) => p.pass)).toEqual([1, 3]);
    expect(withPass([done(1), done(3)], 3, null).map((p) => p.pass)).toEqual([1]);
    expect(withPass([done(1, 'old')], 1, done(1, 'new'))).toEqual([done(1, 'new')]);
  });

  it('knows the highest pass done, 0 before any', () => {
    expect(highestPass([])).toBe(0);
    expect(highestPass([done(1), done(3)])).toBe(3);
  });
});

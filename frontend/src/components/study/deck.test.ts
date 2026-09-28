import { describe, expect, it } from 'vitest';
import {
  currentCard,
  deckReducer,
  isFinished,
  missedIn,
  orderFor,
  parseMarks,
  readMarks,
  shuffle,
  startDeck,
  tally,
  topicsOf,
  type DeckAction,
  type DeckState,
} from './deck';

const run = (state: DeckState, ...actions: DeckAction[]) => actions.reduce(deckReducer, state);

const cards = [
  { group: 'Basics' },
  { group: 'Basics' },
  { group: 'Stories' },
  { group: null },
];

describe('deck order', () => {
  it('lists topics in the order the deck meets them, once each', () => {
    expect(topicsOf(cards)).toEqual(['Basics', 'Stories']);
  });

  it('takes every card, or only one topic', () => {
    expect(orderFor(cards)).toEqual([0, 1, 2, 3]);
    expect(orderFor(cards, 'Basics')).toEqual([0, 1]);
  });

  it('shuffles into a permutation driven by the random source', () => {
    const order = [0, 1, 2, 3, 4];
    expect(shuffle(order, () => 0)).toEqual([1, 2, 3, 4, 0]);
    expect(shuffle(order, () => 0.999).sort()).toEqual(order);
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('deckReducer', () => {
  it('turns the card and back', () => {
    const state = run(startDeck([0, 1]), { type: 'turn' });
    expect(state.turned).toBe(true);
    expect(run(state, { type: 'turn' }).turned).toBe(false);
  });

  it('moving shows the next card face up', () => {
    const state = run(startDeck([4, 7]), { type: 'turn' }, { type: 'next' });
    expect(currentCard(state)).toBe(7);
    expect(state.turned).toBe(false);
    expect(currentCard(run(state, { type: 'previous' }))).toBe(4);
  });

  it('does not move before the first card', () => {
    const state = startDeck([0, 1]);
    expect(run(state, { type: 'previous' })).toBe(state);
  });

  it('marking records the card and moves on; the last one ends the pass', () => {
    const state = run(startDeck([2, 5]), { type: 'mark', mark: 'knew' }, { type: 'mark', mark: 'learning' });
    expect(state.marks).toEqual({ 2: 'knew', 5: 'learning' });
    expect(isFinished(state)).toBe(true);
    expect(currentCard(state)).toBeNull();
    expect(run(state, { type: 'mark', mark: 'knew' })).toBe(state);
    expect(run(state, { type: 'next' })).toBe(state);
  });

  it('a new pass keeps the marks; forgetting clears them', () => {
    const marked = run(startDeck([0, 1]), { type: 'mark', mark: 'knew' });
    const again = run(marked, { type: 'begin', order: [1] });
    expect(again).toMatchObject({ order: [1], position: 0, turned: false, marks: { 0: 'knew' } });
    expect(run(again, { type: 'forget' }).marks).toEqual({});
    expect(run(again, { type: 'restore', marks: { 1: 'learning' } }).marks).toEqual({ 1: 'learning' });
  });
});

describe('the end of a pass', () => {
  const marks = { 0: 'knew', 1: 'learning' } as const;

  it('counts known, still learning and unmarked cards of the pass', () => {
    expect(tally([0, 1, 2], marks)).toEqual({ knew: 1, learning: 1, unmarked: 1, total: 3 });
  });

  it('missed means anything not known, in pass order', () => {
    expect(missedIn([2, 1, 0], marks)).toEqual([2, 1]);
  });
});

describe('remembered marks', () => {
  it('keeps only valid marks for cards that exist', () => {
    expect(parseMarks('{"0":"knew","1":"maybe","7":"learning","x":"knew","2":"learning"}', 5)).toEqual({ 0: 'knew', 2: 'learning' });
    expect(parseMarks('not json', 5)).toEqual({});
    expect(parseMarks('[1]', 5)).toEqual({});
    expect(parseMarks(null, 5)).toEqual({});
  });

  it('works without storage, or when it throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readMarks(broken, 'a1', 3)).toEqual({});
    expect(readMarks(undefined, 'a1', 3)).toEqual({});
  });
});

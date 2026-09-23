import { describe, expect, it } from 'vitest';
import { currentId, initialTriage, keyToCommand, triageReducer, type TriageAction } from './triage';

const run = (order: string[], ...actions: TriageAction[]) => actions.reduce(triageReducer, initialTriage(order));

describe('keyToCommand', () => {
  it.each([
    ['j', 'next'],
    ['ArrowDown', 'next'],
    ['k', 'prev'],
    ['a', 'approve'],
    ['r', 'reject'],
    ['e', 'edit'],
    ['Enter', 'open'],
    ['?', 'help'],
    ['q', null],
  ])('%s → %s', (key, command) => {
    expect(keyToCommand({ key, targetTag: 'BODY' })).toBe(command);
  });

  it('ignores keys typed into a field, except Escape', () => {
    expect(keyToCommand({ key: 'a', targetTag: 'INPUT' })).toBeNull();
    expect(keyToCommand({ key: 'a', targetTag: 'DIV', targetEditable: true })).toBeNull();
    expect(keyToCommand({ key: 'Escape', targetTag: 'TEXTAREA' })).toBe('escape');
  });

  it('ignores chords so browser shortcuts keep working', () => {
    expect(keyToCommand({ key: 'r', metaKey: true })).toBeNull();
  });
});

describe('triageReducer', () => {
  it('moves the cursor and stops at both ends', () => {
    expect(currentId(run(['a', 'b'], { type: 'move', by: 1 }, { type: 'move', by: 1 }))).toBe('b');
    expect(currentId(run(['a', 'b'], { type: 'move', by: -1 }))).toBe('a');
  });

  it('removing the focused item lands on the next one', () => {
    const state = run(['a', 'b', 'c'], { type: 'move', by: 1 }, { type: 'remove', ids: ['b'] });
    expect(state.order).toEqual(['a', 'c']);
    expect(currentId(state)).toBe('c');
  });

  it('removing the last item lands on the new last one', () => {
    expect(currentId(run(['a', 'b'], { type: 'move', by: 1 }, { type: 'remove', ids: ['b'] }))).toBe('a');
  });

  it('removing an item above the cursor keeps focus on the same item', () => {
    expect(currentId(run(['a', 'b', 'c'], { type: 'focus', id: 'c' }, { type: 'remove', ids: ['a'] }))).toBe('c');
  });

  it('sync keeps focus on the same id when the order changes', () => {
    expect(currentId(run(['a', 'b'], { type: 'focus', id: 'b' }, { type: 'sync', order: ['b', 'x', 'a'] }))).toBe('b');
  });

  it('selection toggles and drops ids that leave the queue', () => {
    const state = run(['a', 'b'], { type: 'toggleSelect', id: 'a' }, { type: 'toggleSelect', id: 'b' }, { type: 'toggleSelect', id: 'a' });
    expect(state.selected).toEqual(['b']);
    expect(triageReducer(state, { type: 'remove', ids: ['b'] }).selected).toEqual([]);
  });

  it('help toggles', () => {
    expect(run([], { type: 'help' }).help).toBe(true);
    expect(run([], { type: 'help' }, { type: 'help' }).help).toBe(false);
  });
});

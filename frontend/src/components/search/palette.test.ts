import { describe, expect, it } from 'vitest';
import type { SuggestItem } from '../../lib/api/types/search';
import { buildItems, closedPalette, isPaletteShortcut, paletteReducer, recentItems, type PaletteState } from './palette';

const doc = { id: 'm', slug: 'meadows', title: 'Thinking in Systems', authors: ['Donella Meadows'] };
const suggest: SuggestItem[] = [
  { kind: 'document', label: 'Thinking in Systems', document: doc, anchor: null },
  { kind: 'chapter', label: 'Stocks and flows', document: doc, anchor: 'ch01' },
  { kind: 'concept', label: 'feedback loop', id: 'c1', document: null, anchor: null },
  { kind: 'concept', label: 'no id yet', document: null, anchor: null },
];

describe('buildItems', () => {
  it('lists documents, chapters and concepts by their ids (skipping one without), then search and ask', () => {
    expect(buildItems('flow', suggest).map((i) => [i.kind, i.href])).toEqual([
      ['document', '/documents/meadows'],
      ['chapter', '/documents/meadows/read/ch01'],
      ['concept', '/concepts/c1'],
      ['search', '/search?q=flow'],
      ['ask', '/search?q=flow&ask=1'],
    ]);
  });

  it('has nothing for a blank query', () => {
    expect(buildItems('  ', suggest)).toEqual([]);
  });
});

describe('paletteReducer', () => {
  const recent = recentItems([{ label: 'loops', href: '/search?q=loops' }]);
  const open = paletteReducer(closedPalette, { type: 'open', recent });
  const items = buildItems('flow', suggest);

  it('opens on recent entries', () => {
    expect([open.open, open.items.map((i) => i.label)]).toEqual([true, ['loops']]);
  });

  it('ignores results for a query the user has already typed past', () => {
    const typed = paletteReducer(paletteReducer(open, { type: 'query', query: 'fl', recent }), { type: 'query', query: 'flow', recent });
    const stale = paletteReducer(typed, { type: 'results', query: 'fl', items: items.slice(0, 1) });
    const fresh = paletteReducer(stale, { type: 'results', query: 'flow', items });
    expect([stale.items, stale.loading, fresh.items.length, fresh.loading]).toEqual([recent, true, 5, false]);
  });

  it('moves the active item with the arrows, wrapping at both ends', () => {
    const loaded: PaletteState = { ...open, query: 'flow', items, resultsFor: 'flow' };
    const up = paletteReducer(loaded, { type: 'move', delta: -1 });
    const down = paletteReducer(up, { type: 'move', delta: 1 });
    expect([up.active, down.active]).toEqual([4, 0]);
  });

  it('returns to recent entries when the query is cleared, and resets on close', () => {
    const cleared = paletteReducer({ ...open, query: 'flow', items, active: 3 }, { type: 'query', query: '', recent });
    expect([cleared.items, cleared.active, cleared.loading]).toEqual([recent, 0, false]);
    expect(paletteReducer(cleared, { type: 'close' })).toEqual(closedPalette);
  });
});

describe('isPaletteShortcut', () => {
  const key = { key: 'k', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it('accepts cmd-K and ctrl-K only', () => {
    expect([
      isPaletteShortcut({ ...key, metaKey: true }),
      isPaletteShortcut({ ...key, key: 'K', ctrlKey: true }),
      isPaletteShortcut(key),
      isPaletteShortcut({ ...key, metaKey: true, shiftKey: true }),
    ]).toEqual([true, true, false, false]);
  });
});

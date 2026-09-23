import { describe, expect, it } from 'vitest';
import { diffSegments, diffStats, normalizeBlocks, splitSides } from './normalize';

describe('normalizeBlocks', () => {
  it('renders one line per block, list item and table row, keeping cites as tokens', () => {
    const text = normalizeBlocks([
      { type: 'heading', level: 2, text: 'Leverage' },
      { type: 'paragraph', spans: [{ text: 'Rules  outrank', cites: [] }, { text: 'parameters.', cites: ['ch06/p003'] }] },
      { type: 'bullets', items: [[{ text: 'Delays', cites: [] }], [{ text: 'Loops', cites: ['ch06/p004'] }]] },
      { type: 'callout', tone: 'remember', spans: [{ text: 'Structure first.', cites: [] }] },
      { type: 'table', header: ['Point', 'Power'], rows: [[{ text: 'Paradigm', cites: [] }, { text: 'High', cites: ['ch06/p009'] }]] },
      { type: 'quote', text: 'A system is more than its parts.', cites: ['ch01/p001'], page: 12 },
    ]);
    expect(text).toBe(
      [
        '## Leverage',
        'Rules outrank parameters. [ch06/p003]',
        '• Delays',
        '• Loops [ch06/p004]',
        '[Remember] Structure first.',
        'Point | Power',
        'Paradigm | High [ch06/p009]',
        '“A system is more than its parts.” (p. 12) [ch01/p001]',
      ].join('\n'),
    );
  });
});

describe('diffSegments', () => {
  it('marks inserted and deleted words, merging adjacent runs', () => {
    const segments = diffSegments('Rules outrank parameters.', 'Paradigms outrank parameters.');
    expect(segments).toEqual([
      { kind: 'del', text: 'Rules' },
      { kind: 'ins', text: 'Paradigms' },
      { kind: 'same', text: ' outrank parameters.' },
    ]);
    expect(diffStats(segments)).toEqual({ inserted: 1, deleted: 1 });
  });

  it('sees a dropped cite as a deletion', () => {
    const segments = diffSegments('Flows fill stocks. [ch01/p002]', 'Flows fill stocks.');
    expect(segments.filter((s) => s.kind === 'del').map((s) => s.text.trim())).toEqual(['[ch01/p002]']);
  });

  it('is a single unchanged segment for equal texts', () => {
    expect(diffSegments('same text', 'same text')).toEqual([{ kind: 'same', text: 'same text' }]);
  });

  it('splits into an old column without insertions and a new one without deletions', () => {
    const { before, after } = splitSides(diffSegments('a b', 'a c'));
    expect(before.map((s) => s.kind)).not.toContain('ins');
    expect(after.map((s) => s.kind)).not.toContain('del');
    expect(before.map((s) => s.text).join('')).toBe('a b');
    expect(after.map((s) => s.text).join('')).toBe('a c');
  });
});

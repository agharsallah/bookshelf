import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import { locate, marksFromBody, mergeMarks } from './modelMarks';
import type { Salient } from './salience';

function node(anchor: string, text: string): TreeNode {
  return { id: anchor, anchor, kind: 'paragraph', ordinal: 0, depth: 2, heading: null, text, page_from: 1, page_to: 1, meta: {}, children: [] };
}

describe('locate', () => {
  it('finds an exact copy at its offsets', () => {
    expect(locate('Teams run hot. Slack is not waste.', 'Slack is not waste.')).toEqual({ start: 15, end: 34 });
  });

  it('forgives what the verbatim gate forgives: whitespace runs, curly quotes, long dashes', () => {
    const text = 'It is “held”  in\nreserve — always.';
    const found = locate(text, 'is "held" in reserve - always');
    expect(found && text.slice(found.start, found.end)).toBe('is “held”  in\nreserve — always');
  });

  it('finds nothing for a paraphrase or an empty copy', () => {
    expect(locate('Slack is not waste.', 'Slack is reserve.')).toBeNull();
    expect(locate('Slack is not waste.', '  ')).toBeNull();
  });
});

describe('marksFromBody', () => {
  const nodes = [node('ch01/p001', 'Teams run hot. Slack is not waste.'), node('ch01/p002', 'Kingman’s formula relates the two.')];

  it('places each mark on its cited block, in reading order, as the model chose it', () => {
    const marks = marksFromBody(
      {
        marks: [
          { tier: 'term', text: "Kingman's formula", cites: ['ch01/p002'], why: 'Queue time from load and variability.' },
          { tier: 'core', text: 'Slack is not waste.', cites: ['ch01/p001'], why: 'The thesis.' },
        ],
      },
      nodes,
    );
    expect(marks).toEqual([
      { id: 'ch01/p001@15', anchor: 'ch01/p001', start: 15, end: 34, tier: 'core', title: 'Core idea', why: 'The thesis.', gloss: null, source: 'model' },
      { id: 'ch01/p002@0', anchor: 'ch01/p002', start: 0, end: 17, tier: 'term', title: "Kingman's formula", why: 'Term · defined here', gloss: 'Queue time from load and variability.', source: 'model' },
    ]);
  });

  it('drops what it cannot place and anything malformed; no body means the skill has not run', () => {
    const body = { marks: [{ tier: 'key', text: 'Not in the book.', cites: ['ch01/p001'], why: 'x' }, { tier: 'loud', text: 'Slack', cites: ['ch01/p001'] }, 'nope'] };
    expect(marksFromBody(body, nodes)).toEqual([]);
    expect(marksFromBody(null, nodes)).toBeNull();
  });
});

describe('mergeMarks', () => {
  const s = (id: string, tier: Salient['tier'], start: number, end: number, title: string, source: Salient['source']): Salient => ({ id, anchor: 'a', start, end, tier, title, why: '', gloss: null, source });

  it("keeps the model's marks and adds only the inferred terms it left out", () => {
    const model = [s('m1', 'core', 0, 40, 'Core idea', 'model'), s('m2', 'term', 50, 55, 'Slack', 'model')];
    const inferred = [
      s('h1', 'key', 60, 90, 'Key point', 'heuristic'), // inferred sentences give way to the model's
      s('h2', 'term', 100, 105, 'slack', 'heuristic'), // already named by the model
      s('h3', 'term', 52, 60, 'Slack time', 'heuristic'), // overlaps a model term
      s('h4', 'term', 120, 130, 'Throughput', 'heuristic'),
    ];
    expect(mergeMarks(model, inferred).map((m) => m.id)).toEqual(['m1', 'm2', 'h4']);
  });
});

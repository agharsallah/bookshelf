import { describe, expect, it } from 'vitest';
import { walkSpans } from '../../../lib/contract';
import { tallyGrounding } from '../evidence/grounding';
import { adaptBody, isSynthetic } from './adapters';

const cited = (text: string, anchor = 'ch01/p001') => ({ text, cites: [anchor] });

describe('adaptBody', () => {
  it('passes a blocks body through with concepts and tags as facts', () => {
    const adapted = adaptBody('structured_note', {
      blocks: [{ type: 'paragraph', spans: [cited('Note.')] }],
      tags: ['feedback-loops'],
      concepts: ['stock', 'flow'],
    });
    expect(adapted.blocks).toEqual([{ type: 'paragraph', spans: [cited('Note.')] }]);
    expect(adapted.facts).toEqual([
      { label: 'Concepts', value: 'stock, flow' },
      { label: 'Tags', value: 'feedback-loops' },
    ]);
  });

  it('turns brief sections into headed blocks and read-next into a list', () => {
    const adapted = adaptBody('book_brief', {
      sections: [
        { key: 'thesis', title: 'Thesis', blocks: [{ type: 'paragraph', spans: [cited('One.')] }] },
        { key: 'read_next', title: 'Read next', blocks: [] },
      ],
      read_next: [{ slug: 'meadows-systems', reason: [cited('Same loops.')] }],
    });
    expect(adapted.blocks.map((b) => (b.type === 'heading' ? `h:${b.text}` : b.type))).toEqual(['h:Thesis', 'paragraph', 'h:Read next', 'bullets']);
  });

  it('shows quiz choices with the answer marked, and the cited explanation', () => {
    const adapted = adaptBody('quiz', {
      items: [{ question: 'What changes a stock?', choices: ['Flows', 'Hope', 'Time'], answer: 0, explanation: [cited('Only flows.')] }],
    });
    expect(adapted.blocks[0]).toEqual({ type: 'heading', level: 3, text: '1. What changes a stock?' });
    expect(adapted.blocks[1]).toMatchObject({ type: 'bullets', items: [[{ text: 'Flows', mark: 'strong' }, { text: '— correct' }], [{ text: 'Hope' }], [{ text: 'Time' }]] });
    expect(adapted.blocks[2]).toEqual({ type: 'paragraph', spans: [cited('Only flows.')] });
  });

  it('maps faq items to question headings and answers, flashcards to definitions', () => {
    expect(adaptBody('faq', { items: [{ question: 'Why?', answer: [cited('Because.')] }] }).blocks).toEqual([
      { type: 'heading', level: 3, text: 'Why?' },
      { type: 'paragraph', spans: [cited('Because.')] },
    ]);
    expect(adaptBody('flashcards', { items: [{ front: 'Stock', back: [cited('An accumulation.')] }] }).blocks).toEqual([
      { type: 'definition', term: 'Stock', spans: [cited('An accumulation.')] },
    ]);
  });

  it('appends a figure takeaway as an insight callout and reports its confidence', () => {
    const adapted = adaptBody('figure_description', {
      kind: 'chart',
      caption: 'Figure 3',
      alt: 'Bars',
      blocks: [{ type: 'paragraph', spans: [cited('Rising.')] }],
      takeaway: cited('It lags.'),
      confidence: 'low',
    });
    expect(adapted.blocks.at(-1)).toEqual({ type: 'callout', tone: 'insight', title: 'Takeaway', spans: [cited('It lags.')] });
    expect(adapted.confidence).toBe('low');
    expect(adapted.facts.map((f) => f.label)).toEqual(['Kind', 'Caption', 'Alt text']);
  });

  it('draws concept links as definitions plus an edge table citing the evidence', () => {
    const adapted = adaptBody('concept_links', {
      concepts: [{ canonical: 'stock', aliases: [], kind: 'concept', blurb: [cited('A store.')] }],
      edges: [{ src: { kind: 'concept', ref: 'stock' }, dst: { kind: 'node', ref: 'ch01/p002' }, relation: 'example_of', weight: 0.8, evidence: ['ch01/p002'] }],
    });
    expect(adapted.blocks[0]).toEqual({ type: 'definition', term: 'stock', spans: [cited('A store.')] });
    expect(adapted.blocks[2]).toMatchObject({
      type: 'table',
      rows: [[{ text: 'stock' }, { text: 'example of' }, { text: 'passage ch01/p002' }, { text: '1 passage', cites: ['ch01/p002'] }]],
    });
  });

  it('never counts the text it adds as uncited claims', () => {
    const adapted = adaptBody('quiz', { items: [{ question: 'Q?', choices: ['a', 'b', 'c'], answer: 1, explanation: [cited('E.')] }] });
    const added: boolean[] = [];
    walkSpans(adapted.blocks, (span) => added.push(isSynthetic(span)));
    // choices a, b (+ its "correct" marker), c are added text; the explanation is the claim
    expect(added).toEqual([true, true, true, true, false]);
    expect(tallyGrounding(adapted.blocks)).toEqual({ total: 1, cited: 1, blocks: [] });
  });
});

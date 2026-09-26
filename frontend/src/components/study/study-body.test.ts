import { describe, expect, it } from 'vitest';
import { parseFaq, parseFlashcards, parseGlossary, parseQuiz, parseQuotes, plainText } from './study-body';

const cited = (text: string, ...cites: string[]) => ({ text, cites });

describe('parseFlashcards', () => {
  it('reads front, cited back and topic; drops cards without a front', () => {
    const body = { items: [{ front: 'Q?', back: [cited('A.', 'ch02/p006')], group: ' Basics ' }, { front: '', back: [] }, 'junk'] };
    expect(parseFlashcards(body)).toEqual([{ front: 'Q?', back: [cited('A.', 'ch02/p006')], group: 'Basics' }]);
  });

  it('treats a missing or blank group as none, and a bad body as empty', () => {
    expect(parseFlashcards({ items: [{ front: 'Q?', back: [], group: '  ' }] })[0]?.group).toBeNull();
    expect(parseFlashcards(null)).toEqual([]);
  });
});

describe('parseQuiz', () => {
  it('keeps questions whose answer points at a choice', () => {
    const good = { question: 'Which?', choices: ['a', 'b', 'c'], answer: 2, explanation: [cited('Because.', 'ch01/p001')] };
    const out = parseQuiz({ items: [good, { ...good, answer: 3 }, { ...good, answer: '1' }, { ...good, choices: ['only'] }] });
    expect(out).toEqual([good]);
  });
});

describe('parseFaq', () => {
  it('reads the answer, topic and detail blocks', () => {
    const detail = [{ type: 'bullets', items: [[cited('one')]] }];
    expect(parseFaq({ items: [{ question: 'Why?', answer: [cited('So.')], group: 'Topic', detail }] })).toEqual([
      { question: 'Why?', answer: [cited('So.')], group: 'Topic', detail },
    ]);
    expect(parseFaq({ items: [{ question: 'Why?', answer: [] }] })[0]).toMatchObject({ group: null, detail: [] });
  });
});

describe('parseQuotes and parseGlossary', () => {
  it('keep only their own block type', () => {
    const body = {
      blocks: [
        { type: 'quote', text: 'Said.', attribution: 'Ann', cites: ['ch01/p002'], page: 4 },
        { type: 'quote', text: 'No page.', cites: [] },
        { type: 'paragraph', spans: [] },
        { type: 'definition', term: ' CARL ', spans: [cited('Context, action, result, learning.', 'ch05/p001')] },
      ],
    };
    expect(parseQuotes(body)).toEqual([
      { type: 'quote', text: 'Said.', attribution: 'Ann', cites: ['ch01/p002'], page: 4 },
      { type: 'quote', text: 'No page.', cites: [], page: null },
    ]);
    expect(parseGlossary(body)).toEqual([{ type: 'definition', term: 'CARL', spans: [cited('Context, action, result, learning.', 'ch05/p001')] }]);
  });
});

it('plainText joins span text', () => {
  expect(plainText([cited('One.'), cited('Two.')])).toBe('One. Two.');
});

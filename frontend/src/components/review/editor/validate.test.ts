import { describe, expect, it } from 'vitest';
import { blockProblems, parseRawBody, validateLists } from './validate';

describe('blockProblems', () => {
  it.each([
    [{ type: 'paragraph', spans: [{ text: 'Cited.', cites: ['ch01/p001'] }] }],
    [{ type: 'heading', level: 3, text: 'Loops' }],
    [{ type: 'callout', tone: 'remember', spans: [{ text: 'Recall.', cites: [] }] }],
    [{ type: 'table', header: ['a', 'b'], rows: [[{ text: '1', cites: [] }, { text: '2', cites: [] }]] }],
    [{ type: 'quote', text: 'Verbatim.', cites: ['ch01/p001'], page: null }],
    [{ type: 'diagram', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'a' }], cites: [] }],
  ])('accepts a valid %o', (block) => {
    expect(blockProblems(block)).toEqual([]);
  });

  it.each([
    [{ type: 'essay', text: 'x' }, '“essay” is not one of the 12 block types.'],
    [{ type: 'heading', level: 1, text: 'Top' }, 'Heading level must be 2, 3 or 4.'],
    [{ type: 'paragraph', spans: [] }, 'The paragraph needs at least one span of text.'],
    [{ type: 'paragraph', spans: [{ text: '  ', cites: [] }] }, 'The paragraph is empty.'],
    [{ type: 'paragraph', spans: [{ text: 'x', cites: ['Chapter 3'] }] }, 'The paragraph: “Chapter 3” is not an anchor.'],
    [{ type: 'paragraph', spans: [{ text: 'x', cites: ['ch01', 'ch01'] }] }, 'The paragraph: the same anchor is cited twice.'],
    [{ type: 'callout', tone: 'loud', spans: [{ text: 'x', cites: [] }] }, 'Pick a callout tone.'],
    [{ type: 'table', header: ['a', 'b'], rows: [[{ text: '1', cites: [] }]] }, 'Row 1 does not have 2 cells.'],
    [{ type: 'quote', text: 'q', cites: [], page: -2 }, 'The page must be a whole number or blank.'],
    [{ type: 'diagram', nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'z' }], cites: [] }, '1 edge(s) point at a missing node.'],
  ])('rejects %o', (block, message) => {
    expect(blockProblems(block)).toContain(message);
  });

  it('names the list and block of each problem', () => {
    const lists = [{ label: 'Body', path: ['blocks'], blocks: [{ type: 'heading', level: 2, text: 'ok' }, { type: 'definition', term: '', spans: [{ text: 'x', cites: [] }] }] }];
    expect(validateLists(lists as never)).toEqual([{ list: 0, block: 1, message: 'The term is empty.' }]);
  });
});

describe('parseRawBody', () => {
  it('reads a JSON object', () => {
    expect(parseRawBody('{"blocks": []}')).toEqual({ body: { blocks: [] } });
  });

  it.each(['[1, 2]', '"text"'])('refuses %s, which is not an object', (text) => {
    expect(parseRawBody(text)).toEqual({ error: 'The body must be a JSON object.' });
  });

  it('reports a syntax error', () => {
    expect(parseRawBody('{blocks')).toHaveProperty('error');
  });
});

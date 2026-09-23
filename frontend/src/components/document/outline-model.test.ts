import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import {
  addSection,
  mergeWithNext,
  outlineFromTree,
  sameOutline,
  split,
  toPayload,
  validate,
  type Outline,
} from './outline-model';

const outline = (): Outline => [
  { title: 'Waiting', page_from: 1, page_to: 10, sections: [{ title: 'Queues', page_from: 3 }, { title: 'Delay', page_from: 7 }] },
  { title: 'Flow', page_from: 11, page_to: 20, sections: [{ title: 'WIP', page_from: 14 }] },
];

const messages = (o: Outline, pages: number | null = 30) => validate(o, pages).map((p) => p.message);

describe('validate', () => {
  it('accepts a well-formed outline, including chapters sharing a page', () => {
    const o = outline();
    o[1]!.page_from = 10;
    expect(messages(o)).toEqual([]);
  });

  it('rejects a chapter whose pages run backwards', () => {
    const o = outline();
    o[0]!.page_to = 0;
    expect(messages(o)).toContain("'Waiting': the last page is before the first.");
  });

  it('rejects overlapping chapters and pages beyond the document', () => {
    const o = outline();
    o[1]!.page_from = 9;
    expect(messages(o, 15)).toEqual(["'Flow': the document has only 15 pages.", "'Flow' starts before 'Waiting' ends."]);
  });

  it('rejects sections outside their chapter or out of order', () => {
    const o = outline();
    o[0]!.sections = [{ title: 'Late', page_from: 12 }, { title: 'Early', page_from: 5 }, { title: 'Back', page_from: 4 }];
    expect(messages(o)).toEqual(["'Late' starts outside its chapter's pages.", "'Back' starts before the section above it."]);
  });

  it('accepts open-ended chapters and judges their sections by the start page only', () => {
    const o: Outline = [
      { title: 'Waiting', page_from: 1, page_to: null, sections: [{ title: 'Queues', page_from: 9 }] },
      { title: 'Flow', page_from: 11, sections: [] },
    ];
    expect(messages(o)).toEqual([]);
  });

  it('rejects chapters out of page order even when the earlier one is open-ended', () => {
    const o = outline();
    o[0]!.page_to = null;
    o[1]!.page_from = 1;
    o[0]!.page_from = 2;
    expect(messages(o)).toContain("'Flow' starts before 'Waiting' does; keep chapters in page order.");
  });

  it('rejects a title over 500 characters and accepts one of exactly 500', () => {
    const o = outline();
    o[0]!.title = 'x'.repeat(500);
    o[1]!.title = 'y'.repeat(501);
    expect(messages(o)).toEqual([`'${'y'.repeat(501)}': the title is longer than 500 characters.`]);
  });

  it('requires titles', () => {
    const o = outline();
    o[0]!.title = '  ';
    expect(messages(o)).toEqual(['Chapter 1 needs a title.']);
  });
});

describe('mergeWithNext', () => {
  it('spans both chapters and keeps the second title as a section', () => {
    expect(mergeWithNext(outline(), 0)).toEqual([
      {
        title: 'Waiting',
        page_from: 1,
        page_to: 20,
        sections: [
          { title: 'Queues', page_from: 3 },
          { title: 'Delay', page_from: 7 },
          { title: 'Flow', page_from: 11 },
          { title: 'WIP', page_from: 14 },
        ],
      },
    ]);
  });

  it('stays open-ended when the second chapter was', () => {
    const o = outline();
    o[1]!.page_to = null;
    expect(mergeWithNext(o, 0)[0]?.page_to).toBeNull();
  });

  it('does nothing on the last chapter', () => {
    const o = outline();
    expect(mergeWithNext(o, 1)).toBe(o);
  });
});

describe('split', () => {
  it('starts a new chapter at the page and moves later sections into it', () => {
    const [first, second, third] = split(outline(), 0, 7, 'Delays');
    expect(first).toEqual({ title: 'Waiting', page_from: 1, page_to: 6, sections: [{ title: 'Queues', page_from: 3 }] });
    expect(second).toEqual({ title: 'Delays', page_from: 7, page_to: 10, sections: [{ title: 'Delay', page_from: 7 }] });
    expect(third?.title).toBe('Flow');
  });

  it.each([1, 11])('refuses to split at page %i (the first page or outside)', (page) => {
    const o = outline();
    expect(split(o, 0, page, 'x')).toBe(o);
  });

  it('keeps the second half of an open-ended chapter open-ended', () => {
    const o = outline();
    o[1]!.page_to = null;
    const [, first, second] = split(o, 1, 15, 'Batches');
    expect([first?.page_to, second?.page_from, second?.page_to]).toEqual([14, 15, null]);
  });

  it('produces an outline that validates', () => {
    expect(messages(split(outline(), 1, 15, 'Batches'))).toEqual([]);
  });
});

describe('addSection', () => {
  it('keeps sections in page order', () => {
    const [ch] = addSection(outline(), 0, { title: 'Slack', page_from: 5 });
    expect(ch?.sections.map((s) => s.title)).toEqual(['Queues', 'Slack', 'Delay']);
  });
});

describe('toPayload', () => {
  it('trims titles', () => {
    const o = outline();
    o[0]!.title = '  Waiting ';
    o[0]!.sections[0]!.title = ' Queues';
    const { chapters } = toPayload(o);
    expect([chapters[0]!.title, chapters[0]!.sections[0]!.title]).toEqual(['Waiting', 'Queues']);
  });

  it('sends page_to only when set and skip only when true', () => {
    const o = outline();
    o[0]!.page_to = null;
    o[0]!.skip = true;
    o[1]!.skip = false;
    expect(toPayload(o).chapters.map((c) => [c.page_to, c.skip])).toEqual([
      [undefined, true],
      [20, undefined],
    ]);
  });

  it('treats a blank page_to and a missing one as the same outline', () => {
    const o = outline();
    delete o[1]!.page_to;
    const edited = outline();
    edited[1]!.page_to = null;
    expect([sameOutline(o, edited), sameOutline(o, outline())]).toEqual([true, false]);
  });
});

function node(partial: Partial<TreeNode> & Pick<TreeNode, 'anchor' | 'kind'>): TreeNode {
  return {
    id: partial.anchor,
    ordinal: 0,
    depth: partial.anchor.split('/').length - 1,
    heading: null,
    text: null,
    page_from: null,
    page_to: null,
    meta: {},
    children: [],
    ...partial,
  };
}

describe('outlineFromTree', () => {
  it('skips front matter, keeps skip marks, fills missing page ends from the next chapter, keeps sections', () => {
    const tree = [
      node({ anchor: 'fm01', kind: 'chapter', heading: 'Front matter', meta: { front_matter: true }, page_from: 1, page_to: 2 }),
      node({
        anchor: 'ch01',
        kind: 'chapter',
        heading: 'Waiting',
        page_from: 3,
        page_to: null,
        children: [node({ anchor: 'ch01/s01', kind: 'section', heading: 'Queues', page_from: 4 })],
      }),
      node({ anchor: 'ch02', kind: 'chapter', heading: 'Flow', page_from: 9, page_to: null }),
      node({ anchor: 'ch03', kind: 'chapter', heading: 'Index', page_from: 12, page_to: 12, meta: { skip: true } }),
    ];
    expect(outlineFromTree(tree, 12)).toEqual([
      { title: 'Waiting', page_from: 3, page_to: 8, sections: [{ title: 'Queues', page_from: 4 }] },
      { title: 'Flow', page_from: 9, page_to: 11, sections: [] },
      { title: 'Index', page_from: 12, page_to: 12, skip: true, sections: [] },
    ]);
  });
});

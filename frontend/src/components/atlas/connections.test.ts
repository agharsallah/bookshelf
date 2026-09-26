import { describe, expect, it } from 'vitest';
import { appearances, bookIdeas, chaptersOf, echoesOf, relatedIdeas, sharedWith } from './connections';
import { ids, shelf } from './fixtures';
import { indexAtlas } from './model';

const index = indexAtlas(shelf());

describe('connections', () => {
  it('lists where a concept appears, book by book in reading order', () => {
    expect(appearances(index, ids.law).map((l) => [l.node.label, l.relation])).toEqual([
      ['Queues', 'defines'],
      ['Stories', 'mentions'],
    ]);
  });

  it('lists related ideas strongest first, with their direction', () => {
    expect(relatedIdeas(index, ids.wip).map((l) => [l.node.label, l.relation, l.outgoing])).toEqual([
      ['big batch', 'contradicts', true],
      ["little's law", 'supports', true],
    ]);
  });

  it('says which chapters share a chapter’s ideas, and through what', () => {
    const shared = sharedWith(index, ids.queues);
    expect(shared.map((s) => [s.chapter.label, s.concepts.map((c) => c.label)])).toEqual([['Stories', ["little's law"]]]);
  });

  it('gives a book its chapters in order and the ideas it leans on most', () => {
    expect(chaptersOf(index, ids.flow).map((l) => l.node.label)).toEqual(['Queues', 'Limits']);
    expect(bookIdeas(index, ids.flow).map((n) => n.label)).toEqual(["little's law", 'wip limit']);
  });
});

describe('appearances', () => {
  it('lists a chapter once, with every way the concept links there', () => {
    const atlas = shelf();
    atlas.edges.push({ ...atlas.edges[3]!, id: 'm9', relation: 'mentions', evidence_count: 3 });
    const [queues] = appearances(indexAtlas(atlas), ids.law);
    expect(queues?.node.label).toBe('Queues');
    expect(queues?.relations).toEqual(['mentions', 'defines']);
    expect(queues?.passages).toBe(5);
  });
});

describe('echoesOf', () => {
  it('names the echoing chapter and opens its own echoing passage, not ours', () => {
    const atlas = shelf();
    const [, , queues, , stories] = atlas.nodes;
    atlas.edges.push({
      ...atlas.edges[8]!,
      id: 'e1',
      relation: 'echoes',
      concepts: [],
      evidence: [`${queues?.document?.id}#ch01/p003`, `${stories?.document?.id}#ch01/p007`],
    });
    const [echo] = echoesOf(indexAtlas(atlas), ids.queues);
    expect(echo?.chapter.label).toBe('Stories');
    expect(echo?.passage).toBe('ch01/p007');
  });
});

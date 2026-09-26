import { describe, expect, it } from 'vitest';
import type { ConceptEdge, GraphDocument, Passage } from '../../lib/api/types/graph';
import { connectionShare, evidenceByBook, strongestOf } from './concept-stats';

const book = (id: string, title: string): GraphDocument => ({ id, slug: id, title });
const passage = (doc: GraphDocument, anchor: string): Passage => ({
  ref: `${doc.id}#${anchor}`, document: doc, anchor, kind: 'p', heading: null, snippet: null, exists: true,
});
const edge = (id: string, evidence: Passage[]): ConceptEdge => ({
  id, relation: 'supports', direction: 'out', weight: 1, status: 'accepted', origin: 'skill', evidence,
  other: { id: 'concept:x', kind: 'concept', label: 'x' } as ConceptEdge['other'],
});

describe('connection meter', () => {
  it('finds the strongest concept in view', () => {
    expect(strongestOf([{ edge_count: 2 }, { edge_count: 11 }, {}])).toBe(11);
    expect(strongestOf([])).toBe(0);
  });

  it('scales to the strongest, never hides a single link, and is empty for none', () => {
    expect(connectionShare(11, 11)).toBe(1);
    expect(connectionShare(5, 10)).toBe(0.5);
    expect(connectionShare(1, 100)).toBe(0.08);
    expect(connectionShare(0, 10)).toBe(0);
    expect(connectionShare(undefined, 10)).toBe(0);
  });
});

describe('evidenceByBook', () => {
  const a = book('a', 'Alpha');
  const b = book('b', 'Beta');

  it('counts distinct passages and citing links per book, most passages first', () => {
    const shared = passage(b, '2/p4');
    const result = evidenceByBook({
      blurb_passages: [passage(a, '1/p1'), shared],
      relations: [
        { relation: 'supports', edges: [edge('e1', [shared, passage(b, '3/p1')]), edge('e2', [passage(b, '4/p9'), passage(a, '1/p1')])] },
      ],
    });
    expect(result).toEqual([
      { document: b, passages: 3, connections: 2 },
      { document: a, passages: 1, connections: 1 },
    ]);
  });

  it('skips passages whose book is unknown', () => {
    const orphan = { ...passage(a, '1/p1'), document: null };
    expect(evidenceByBook({ blurb_passages: [orphan], relations: [] })).toEqual([]);
  });
});

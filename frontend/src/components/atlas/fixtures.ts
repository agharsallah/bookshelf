/**
 * A two-book atlas for map tests:
 *
 *   Flow (doc f) ─contains→ Queues (f#ch01), Limits (f#ch02)
 *   Talks (doc t) ─contains→ Stories (t#ch01)
 *   Queues ─defines→ little's law ←mentions─ Stories        (little's law: two books)
 *   Limits ─mentions→ wip limit ─supports→ little's law
 *   wip limit ─contradicts→ big batch   (framework, no chapter)
 *   Queues ─shares→ Stories (via little's law)
 */
import type { Atlas, AtlasEdge, AtlasNode } from '../../lib/api/types/graph';

export const F = '00000000-0000-4000-8000-00000000000f';
export const T = '00000000-0000-4000-8000-00000000000e';

const doc = (id: string, slug: string, title: string) => ({ id, slug, title });
const FLOW = doc(F, 'flow', 'Flow');
const TALKS = doc(T, 'talks', 'Talks');

function node(id: string, kind: AtlasNode['kind'], label: string, extra: Partial<AtlasNode> = {}): AtlasNode {
  return {
    id,
    kind,
    label,
    sublabel: null,
    document: null,
    anchor: null,
    blurb: null,
    concept_kind: null,
    ordinal: 0,
    degree: 1,
    books: 0,
    passages: 0,
    ...extra,
  };
}

function line(id: string, src: string, relation: AtlasEdge['relation'], dst: string, extra: Partial<AtlasEdge> = {}): AtlasEdge {
  return {
    id,
    src,
    dst,
    relation,
    weight: 1,
    evidence_count: 1,
    status: 'accepted',
    edge_ids: [id],
    evidence: [],
    concepts: [],
    ...extra,
  };
}

export const ids = {
  flow: `document:${F}`,
  talks: `document:${T}`,
  queues: `node:${F}#ch01`,
  limits: `node:${F}#ch02`,
  stories: `node:${T}#ch01`,
  law: 'concept:law',
  wip: 'concept:wip',
  batch: 'concept:batch',
};

export function shelf(): Atlas {
  return {
    nodes: [
      node(ids.flow, 'document', 'Flow', {
        document: FLOW,
        sublabel: 'A. Author',
        degree: 2,
      }),
      node(ids.talks, 'document', 'Talks', { document: TALKS, degree: 1 }),
      node(ids.queues, 'chapter', 'Queues', {
        document: FLOW,
        anchor: 'ch01',
        sublabel: 'Flow',
        ordinal: 1,
        degree: 3,
      }),
      node(ids.limits, 'chapter', 'Limits', {
        document: FLOW,
        anchor: 'ch02',
        sublabel: 'Flow',
        ordinal: 2,
        degree: 2,
      }),
      node(ids.stories, 'chapter', 'Stories', {
        document: TALKS,
        anchor: 'ch01',
        sublabel: 'Talks',
        ordinal: 1,
        degree: 3,
      }),
      node(ids.law, 'concept', "little's law", {
        concept_kind: 'framework',
        books: 2,
        passages: 3,
        degree: 3,
        blurb: 'Items = rate × time.',
      }),
      node(ids.wip, 'concept', 'wip limit', {
        concept_kind: 'concept',
        books: 1,
        passages: 1,
        degree: 3,
      }),
      node(ids.batch, 'concept', 'big batch', {
        concept_kind: 'concept',
        degree: 1,
      }),
    ],
    edges: [
      line('c1', ids.flow, 'contains', ids.queues, {
        edge_ids: [],
        evidence_count: 0,
      }),
      line('c2', ids.flow, 'contains', ids.limits, {
        edge_ids: [],
        evidence_count: 0,
      }),
      line('c3', ids.talks, 'contains', ids.stories, {
        edge_ids: [],
        evidence_count: 0,
      }),
      line('d1', ids.queues, 'defines', ids.law, { evidence_count: 2 }),
      line('m1', ids.stories, 'mentions', ids.law, { weight: 0.3 }),
      line('m2', ids.limits, 'mentions', ids.wip, { weight: 0.4 }),
      line('s1', ids.wip, 'supports', ids.law),
      line('x1', ids.wip, 'contradicts', ids.batch),
      line('h1', ids.queues, 'shares', ids.stories, {
        edge_ids: [],
        evidence_count: 1,
        concepts: [ids.law],
      }),
    ],
    truncated: false,
  };
}

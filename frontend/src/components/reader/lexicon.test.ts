import { describe, expect, it } from 'vitest';
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import { lexiconFrom, lexiconFromArtifacts } from './lexicon';

const conceptLinks = {
  concepts: [
    { canonical: 'work in progress', aliases: ['WIP', 'work-in-process'], kind: 'concept', blurb: [{ text: 'Items started, not finished.', cites: ['ch02/p005'] }] },
    { canonical: "kingman's formula", aliases: [], kind: 'framework', blurb: [{ text: 'Queue time from utilization.', cites: [] }] },
  ],
  edges: [
    { src: { kind: 'node', ref: 'ch02/p005' }, dst: { kind: 'concept', ref: 'work in progress' }, relation: 'defines', weight: 1, evidence: ['ch02/p006'] },
    { src: { kind: 'concept', ref: 'work in progress' }, dst: { kind: 'concept', ref: "kingman's formula" }, relation: 'supports', weight: 1, evidence: ['ch03/p001'] },
  ],
};

const glossary = {
  blocks: [
    { type: 'definition', term: "Kingman's formula", spans: [{ text: 'An approximation of expected queue time.', cites: ['ch03/p008'] }] },
    { type: 'definition', term: 'Flow efficiency', spans: [{ text: 'Share of time spent working.', cites: ['ch06/p001'] }] },
  ],
};

describe('lexiconFrom', () => {
  it('turns concepts into terms: spellings longest first, too-short aliases dropped, blurb as the gloss', () => {
    const [wip] = lexiconFrom(conceptLinks, null);
    expect(wip).toEqual({
      label: 'work in progress',
      forms: ['work in progress', 'work-in-process', 'wip'],
      kind: 'concept',
      gloss: 'Items started, not finished.',
      defines: ['ch02/p005', 'ch02/p006'],
    });
  });

  it("merges a glossary entry into its concept: the book's spelling and the fuller definition win", () => {
    const terms = lexiconFrom(conceptLinks, glossary);
    const kingman = terms.find((t) => t.forms.includes("kingman's formula"));
    expect(kingman).toMatchObject({ label: "Kingman's formula", kind: 'framework', gloss: 'An approximation of expected queue time.' });
    expect(terms.find((t) => t.label === 'Flow efficiency')).toMatchObject({ kind: 'term', forms: ['flow efficiency'], defines: [] });
    expect(terms).toHaveLength(3);
  });

  it('survives missing or malformed bodies', () => {
    expect(lexiconFrom(null, null)).toEqual([]);
    expect(lexiconFrom({ concepts: 'nope', edges: [null] }, { blocks: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

describe('lexiconFromArtifacts', () => {
  const artifact = (type: string, body: object, review = 'draft', version = 1) =>
    ({ id: `${type}-${version}`, type, anchor: null, review, version, body }) as unknown as ArtifactPublic;

  it('reads the best concept_links and glossary, skipping rejected versions', () => {
    const terms = lexiconFromArtifacts([
      artifact('concept_links', conceptLinks),
      artifact('glossary', { blocks: [{ type: 'definition', term: 'Rejected term', spans: [] }] }, 'rejected', 2),
      artifact('glossary', glossary),
    ]);
    expect(terms.map((t) => t.label).sort()).toEqual(['Flow efficiency', "Kingman's formula", 'work in progress']);
  });
});

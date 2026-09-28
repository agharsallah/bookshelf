import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectCites, type RenderBlock } from '../../lib/contract';
import type { ArtifactType } from '../../lib/api/types/artifacts';
import { adaptBody } from '../review/body/adapters';
import { parseClaimSet, parseIntents, parseResults } from './extract-bodies';
import { parseAssessment, parseJournalClub, parseNotation, parseReview } from './study-bodies';

/** The skills' own examples (skills/<name>/example.json): the shapes the backend validates. */
const example = (skill: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../skills/${skill}/example.json`, import.meta.url), 'utf8'));

const headings = (blocks: RenderBlock[]) => blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : []));

/** Every anchor cited anywhere in a raw body (the `cites` arrays and notation anchors). */
function rawCites(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(rawCites);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, v]) =>
    key === 'cites' && Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : key === 'first_anchor' || key === 'anchor' ? [String(v)] : rawCites(v),
  );
}

describe('the study artifacts in the review queue', () => {
  const cases: [ArtifactType, string][] = [
    ['paper_assessment', 'assess-paper'],
    ['paper_review', 'review-paper'],
    ['notation_table', 'make-notation'],
    ['journal_club', 'make-journal-club'],
    ['claim_set', 'extract-claims'],
    ['results_table', 'extract-results'],
    ['citation_intents', 'classify-citations'],
  ];

  it.each(cases)('draws %s from its skill’s example, keeping every cite', (type, skill) => {
    const raw = example(skill);
    const { blocks } = adaptBody(type, raw);
    expect(blocks.length).toBeGreaterThan(0);
    const drawn = new Set(collectCites(blocks));
    for (const cite of rawCites(raw)) expect(drawn, `${type} lost ${cite}`).toContain(cite);
  });

  it('puts the review report in a referee’s order and names the recommendation', () => {
    const { blocks, facts } = adaptBody('paper_review', example('review-paper'));
    expect(headings(blocks)).toEqual(['Summary', 'Strengths', 'Weaknesses', 'Questions for the authors', 'Missing experiments']);
    expect(blocks.at(-1)).toMatchObject({ type: 'callout', title: 'Weak accept, confidence 4 of 5' });
    expect(facts).toContainEqual({ label: 'Recommendation', value: 'Weak accept' });
  });
});

describe('parseAssessment', () => {
  it('reads the rubric in order, the ten checklist items and the related papers', () => {
    const a = parseAssessment(example('assess-paper'));
    expect(a.scores.map((s) => [s.criterion, s.score])).toEqual([
      ['novelty', 3],
      ['rigour', 3],
      ['evidence', 4],
      ['clarity', 4],
      ['reproducibility', 3],
      ['relevance', 4],
    ]);
    expect(a.reproducibility).toHaveLength(10);
    expect(a.reproducibility.find((r) => r.item === 'compute')?.status).toBe('no');
    expect(a.relatedShelf.map((r) => r.slug)).toEqual(['izacard-fid']);
  });

  it('puts scores in rubric order, keeps one per criterion and clamps them to 1–5', () => {
    const a = parseAssessment({
      scores: [
        { criterion: 'clarity', score: 9, spans: [] },
        { criterion: 'novelty', score: 2, spans: [] },
        { criterion: 'novelty', score: 5, spans: [] },
        { criterion: 'vibes', score: 5, spans: [] },
      ],
      reproducibility: [{ item: 'code', status: 'maybe', spans: [] }],
    });
    expect(a.scores.map((s) => [s.criterion, s.score])).toEqual([
      ['novelty', 2],
      ['clarity', 5],
    ]);
    expect(a.reproducibility[0]?.status).toBe('unknown');
    expect(parseAssessment(null).overall).toEqual([]);
  });
});

describe('parseReview', () => {
  it('lists major weaknesses before minor ones', () => {
    const r = parseReview({
      weaknesses: [
        { severity: 'minor', spans: [{ text: 'a', cites: [] }] },
        { severity: 'major', spans: [{ text: 'b', cites: [] }] },
      ],
      verdict: { recommendation: 'nope', confidence: 3, spans: [] },
    });
    expect(r.weaknesses.map((w) => w.severity)).toEqual(['major', 'minor']);
    expect(r.verdict).toMatchObject({ recommendation: null, confidence: 3 });
  });
});

describe('the other study bodies', () => {
  it('reads the notation in order of first use', () => {
    const symbols = parseNotation(example('make-notation'));
    expect(symbols.map((s) => s.latex)).toEqual(['q', 'p_i', 'w', 'g_i', '\\sigma']);
    expect(symbols[3]).toMatchObject({ meaning: 'Gate score of passage i, between 0 and 1.', firstAnchor: 'ch03/s01/m001' });
  });

  it('reads the journal club pack', () => {
    const club = parseJournalClub(example('make-journal-club'));
    expect(club.keyFigure?.anchor).toBe('ch03/f001');
    expect(club.questions).toHaveLength(5);
    expect([club.debate.for.length, club.debate.against.length]).toEqual([2, 2]);
    expect(parseJournalClub({ key_figure: null }).keyFigure).toBeNull();
  });

  it('reads claims, results and intents, dropping rows it cannot use', () => {
    expect(parseClaimSet(example('extract-claims')).map((c) => [c.key, c.strength])).toEqual([
      ['C1', 'argued'],
      ['C2', 'measured'],
      ['C3', 'measured'],
      ['C4', 'speculated'],
    ]);
    const rows = parseResults(example('extract-results'));
    expect(rows).toHaveLength(4);
    expect(rows[2]).toMatchObject({ metric: 'training cost', unit: 'FLOPs', higherIsBetter: false, isProposed: true });
    expect(parseResults({ rows: [{ method: 'x', metric: 'm', value: 'NaN' }] })).toEqual([]);
    expect(parseIntents(example('classify-citations')).map((c) => c.intent)).toEqual(['background', 'uses', 'extends', 'compares', 'contradicts']);
  });
});

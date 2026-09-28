import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { collectCites, type RenderBlock } from '../../lib/contract';
import { adaptBody, isSynthetic } from '../review/body/adapters';
import { contributionsByKind, explainerBlocks, paperCardBlocks, parseExplainer, parsePaperCard } from './bodies';

/** The skills' own examples (skills/<name>/example.json): the shapes the backend validates. */
const example = (skill: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../../skills/${skill}/example.json`, import.meta.url), 'utf8'));

const headings = (blocks: RenderBlock[]) => blocks.flatMap((b) => (b.type === 'heading' ? [b.text] : []));

describe('parsePaperCard', () => {
  const card = parsePaperCard(example('dissect-paper'));

  it('reads every part of the dissect-paper example', () => {
    expect(card.tldr[0]?.text).toMatch(/^Gated retrieval adapters/);
    expect(card.setup.datasets.map((d) => d.name)).toEqual(['Natural Questions', 'HotpotQA']);
    expect(card.setup.baselines.map((d) => d.name)).toEqual(['FiD-base']);
    expect(card.results.map((b) => b.type)).toEqual(['table', 'callout']);
    expect(card.limitations.stated).toHaveLength(1);
    expect(card.limitations.unstated[0]?.[0]?.text).toMatch(/development sets/);
    expect(card.numbers.map((n) => n.value)).toEqual(['+2.1 EM', '+3.4 EM', '40% fewer']);
  });

  it('groups contributions by kind in the vocabulary’s order', () => {
    expect(contributionsByKind(card).map((g) => [g.label, g.items.length])).toEqual([
      ['Method', 1],
      ['Result', 1],
    ]);
  });

  it('survives a malformed body with empty parts rather than throwing', () => {
    const empty = parsePaperCard({ tldr: 'not spans', setup: [], contributions: [{ kind: 'nope', spans: [{ text: 'x', cites: [] }] }] });
    expect(empty.tldr).toEqual([]);
    expect(empty.setup.datasets).toEqual([]);
    expect(empty.contributions[0]?.kind).toBe('position');
    expect(parsePaperCard(null).numbers).toEqual([]);
  });
});

describe('the paper card as blocks', () => {
  it('draws every section in page order, keeping each claim’s cites', () => {
    const raw = example('dissect-paper');
    const blocks = paperCardBlocks(parsePaperCard(raw));
    expect(headings(blocks).filter((h) => !['Datasets', 'Baselines', 'Metrics', 'Stated by the authors', 'Not stated'].includes(h))).toEqual([
      'In short',
      'The question',
      'Contributions',
      'Method',
      'Setup',
      'Results',
      'Numbers',
      'Limitations',
      'Assumptions',
      'Future work',
    ]);
    expect(collectCites(blocks)).toContain('ch04/s02/t001');
    expect(collectCites(blocks)).toContain('ch05/p003');
  });

  it('is what the review queue shows for a paper card, with the names it adds marked synthetic', () => {
    const { blocks } = adaptBody('paper_card', example('dissect-paper'));
    const setup = blocks.find((b) => b.type === 'bullets' && b.items[0]?.[0]?.text === 'Natural Questions: ');
    expect(setup && setup.type === 'bullets' && isSynthetic(setup.items[0]![0]!)).toBe(true);
  });
});

describe('parseExplainer', () => {
  const explainer = parseExplainer(example('simplify-paper'));

  it('reads prerequisites with their shelf concept, and equations as math blocks', () => {
    expect(explainer.prerequisites.map((p) => [p.concept, p.shelfConcept])).toEqual([
      ['Attention', 'attention'],
      ['Exact match (EM)', null],
    ]);
    expect(explainer.equations[0]).toMatchObject({ type: 'math', latex: 'g_i = \\sigma(w^\\top [q; p_i])', cites: ['ch03/s01/m001'] });
    expect(explainer.analogy?.length).toBe(2);
  });

  it('has no analogy when the skill gave none', () => {
    expect(parseExplainer({ analogy: null }).analogy).toBeNull();
  });

  it('is what the review queue shows for an explainer', () => {
    const { blocks } = adaptBody('paper_explainer', example('simplify-paper'));
    expect(blocks).toEqual(explainerBlocks(explainer));
    expect(headings(blocks)).toEqual(['What you need to know first', 'The idea', 'Walkthrough', 'How it works', 'What it found', 'Key equations']);
    expect(blocks.some((b) => b.type === 'callout' && b.title === 'An analogy')).toBe(true);
  });
});

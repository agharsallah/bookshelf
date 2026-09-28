import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../../lib/api/types/documents';
import { flatten } from '../../../lib/documents/tree';
import { closingUnit, foldLabel, foldOf, nextPass, planUnit, predictionUnit, unitTreatment, visibleAnchors, type PassItem } from './passes';

function node(anchor: string, kind: TreeNode['kind'], extra: Partial<TreeNode> = {}): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: null, page_from: 1, page_to: 1, meta: {}, children: [], ...extra };
}

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

/** A method unit: a lead paragraph, a section with text and a figure, a subsection with a table. */
function methodUnit(role: string | null = 'method'): TreeNode {
  return node('ch03', 'chapter', {
    heading: '3 Model',
    meta: role ? { role } : {},
    children: [
      node('ch03/p001', 'paragraph', { text: words(40) }),
      node('ch03/s01', 'section', {
        heading: '3.1 Attention',
        children: [
          node('ch03/s01/p001', 'paragraph', { text: words(300) }),
          node('ch03/s01/f001', 'figure', { meta: { caption: 'Figure 1' } }),
          node('ch03/s01/m001', 'math', { text: 'softmax(QK^T)V' }),
          node('ch03/s01/ss01', 'section', {
            heading: 'Scaled dot product',
            children: [node('ch03/s01/ss01/p001', 'paragraph', { text: words(10) }), node('ch03/s01/ss01/t001', 'table', { meta: { caption: 'Table 1' } })],
          }),
        ],
      }),
    ],
  });
}

const shown = (items: PassItem[], unit: TreeNode) => {
  const flat = flatten(unit);
  return items.map((i) => (i.type === 'fold' ? `fold:${i.fold.anchor}` : (flat[i.index]?.node.anchor ?? '?')));
};

describe('unitTreatment', () => {
  it('reads the abstract, introduction and conclusion in full on the skim and skims the rest', () => {
    expect(['abstract', 'introduction', 'conclusion'].map((r) => unitTreatment(1, r))).toEqual(['full', 'full', 'full']);
    expect(['method', 'results', 'related_work', null].map((r) => unitTreatment(1, r))).toEqual(['skim', 'skim', 'skim', 'skim']);
  });

  it('folds the appendix and references until the third pass', () => {
    expect([1, 2, 3].map((p) => unitTreatment(p as 1 | 2 | 3, 'appendix'))).toEqual(['folded', 'folded', 'full']);
    expect([1, 2, 3].map((p) => unitTreatment(p as 1 | 2 | 3, 'references'))).toEqual(['folded', 'folded', 'full']);
    expect(unitTreatment(2, 'method')).toBe('full');
  });
});

describe('planUnit', () => {
  it('keeps every block when the mode is off, pass 3, or the unit is read in full', () => {
    const unit = methodUnit();
    const all = flatten(unit).map((f) => f.node.anchor);
    expect(shown(planUnit(null, unit, flatten(unit)), unit)).toEqual(all);
    expect(shown(planUnit(3, unit, flatten(unit)), unit)).toEqual(all);
    expect(shown(planUnit(2, unit, flatten(unit)), unit)).toEqual(all);
    const intro = methodUnit('introduction');
    expect(shown(planUnit(1, intro, flatten(intro)), intro)).toEqual(all);
  });

  it('skims a body unit to its headings, figures and tables, folding the text under each heading', () => {
    const unit = methodUnit();
    const items = planUnit(1, unit, flatten(unit));
    expect(shown(items, unit)).toEqual(['fold:ch03', 'fold:ch03/s01', 'ch03/s01/f001', 'fold:ch03/s01/ss01', 'ch03/s01/ss01/t001']);
    const folds = items.flatMap((i) => (i.type === 'fold' ? [i.fold] : []));
    // The lead text is the unit's opening, not a repeat of the unit's name (already in the toolbar).
    expect(folds.map((f) => f.lead)).toEqual([true, false, false]);
    expect(folds.map((f) => [f.anchor, f.heading, f.level, f.members])).toEqual([
      ['ch03', 'Opening', 0, ['ch03/p001']],
      ['ch03/s01', '3.1 Attention', 1, ['ch03/s01/p001', 'ch03/s01/m001']],
      ['ch03/s01/ss01', 'Scaled dot product', 2, ['ch03/s01/ss01/p001']],
    ]);
    expect(folds[1]).toMatchObject({ words: 301, minutes: 1 });
  });

  it('folds an appendix whole on passes 1 and 2', () => {
    const unit = methodUnit('appendix');
    const items = planUnit(2, unit, flatten(unit));
    expect(shown(items, unit)).toEqual(['fold:ch03']);
    expect(items[0]?.type === 'fold' ? items[0].fold.members : []).toHaveLength(6);
    expect(items[0]?.type === 'fold' ? [items[0].fold.heading, items[0].fold.lead] : []).toEqual(['3 Model', false]);
  });

  it('shows an opened fold as usual and leaves the others folded', () => {
    const unit = methodUnit();
    const items = planUnit(1, unit, flatten(unit), new Set(['ch03/s01']));
    expect(shown(items, unit)).toEqual(['fold:ch03', 'ch03/s01', 'ch03/s01/p001', 'ch03/s01/f001', 'ch03/s01/m001', 'fold:ch03/s01/ss01', 'ch03/s01/ss01/t001']);
    // The lead text opens on its own, without opening the whole unit.
    expect(shown(planUnit(1, unit, flatten(unit), new Set(['ch03'])), unit).slice(0, 2)).toEqual(['ch03/p001', 'fold:ch03/s01']);
    // An appendix opened whole shows everything.
    const appendix = methodUnit('appendix');
    expect(planUnit(1, appendix, flatten(appendix), new Set(['ch03']))).toHaveLength(flatten(appendix).length);
  });

  it('finds the fold hiding a block, and lists what stays on screen', () => {
    const unit = methodUnit();
    const items = planUnit(1, unit, flatten(unit));
    expect(foldOf(items, 'ch03/s01/m001')).toBe('ch03/s01');
    expect(foldOf(items, 'ch03/s01/f001')).toBeNull();
    expect(visibleAnchors(items, flatten(unit))).toEqual(['ch03', 'ch03/s01', 'ch03/s01/f001', 'ch03/s01/ss01', 'ch03/s01/ss01/t001']);
  });

  it('labels a fold with its size and reading time', () => {
    expect(foldLabel({ members: ['a', 'b'], words: 1200, minutes: 5 })).toBe('2 blocks, 1,200 words, 5 min');
    expect(foldLabel({ members: ['f'], words: 0, minutes: 0 })).toBe('1 block');
  });
});

describe('pass boundaries', () => {
  const units = [
    { anchor: 'ch01', role: 'abstract' },
    { anchor: 'ch02', role: 'introduction' },
    { anchor: 'ch06', role: 'conclusion' },
    { anchor: 'ch065', role: 'other' },
    { anchor: 'ch07', role: 'references' },
    { anchor: 'ch08', role: 'appendix' },
  ];

  it('closes passes 1 and 2 at the conclusion (else the last body unit) and pass 3 at the last unit', () => {
    expect(closingUnit(1, units)).toBe('ch06');
    expect(closingUnit(2, units)).toBe('ch06');
    expect(closingUnit(3, units)).toBe('ch08');
    const noConclusion = units.filter((u) => u.role !== 'conclusion');
    expect(closingUnit(1, noConclusion)).toBe('ch065');
  });

  it('files the skim prediction under the abstract, else the first unit', () => {
    expect(predictionUnit(units)).toBe('ch01');
    expect(predictionUnit(units.slice(1))).toBe('ch02');
    expect(predictionUnit([])).toBeNull();
  });

  it('starts the mode at the first pass not done', () => {
    expect(nextPass([])).toBe(1);
    expect(nextPass([1])).toBe(2);
    expect(nextPass([2, 1])).toBe(3);
    expect(nextPass([1, 2, 3])).toBe(3);
    expect(nextPass([2])).toBe(1);
  });
});

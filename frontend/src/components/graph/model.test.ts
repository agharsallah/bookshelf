import { describe, expect, it } from 'vitest';
import { gedge, gnode, hood, star } from './fixtures';
import { buildModel, NODE_CAP, neighbours, nextBudget } from './model';

describe('buildModel', () => {
  it('puts the focus first, then rings by depth and score', () => {
    const model = buildModel(
      hood(
        [gnode('concept:far', 2, { weight: 9 }), gnode('concept:weak', 1, { weight: 0.2 }), gnode('concept:f', 0), gnode('concept:strong', 1, { weight: 0.9 })],
        [gedge('concept:f', 'concept:weak'), gedge('concept:f', 'concept:strong'), gedge('concept:strong', 'concept:far')],
        'concept:f',
      ),
    );
    expect(model.nodes.map((n) => [n.id, n.depth])).toEqual([
      ['concept:f', 0],
      ['concept:strong', 1],
      ['concept:weak', 1],
      ['concept:far', 2],
    ]);
  });

  it('ranks edges by weight × evidence count, counting no evidence as one', () => {
    const model = buildModel(
      hood(
        [gnode('concept:f', 0), gnode('concept:a', 1), gnode('concept:b', 1), gnode('concept:c', 1)],
        [
          gedge('concept:f', 'concept:a', { id: 'light', weight: 0.9, evidence_count: 1 }),
          gedge('concept:f', 'concept:b', { id: 'heavy', weight: 0.5, evidence_count: 4 }),
          gedge('concept:f', 'concept:c', { id: 'bare', weight: 0.95, evidence_count: 0 }),
        ],
      ),
    );
    expect(model.edges.map((e) => [e.id, e.strength])).toEqual([
      ['heavy', 2],
      ['bare', 0.95],
      ['light', 0.9],
    ]);
    expect(model.strongest).toBe(2);
  });

  it('cuts at the budget, drops edges to cut nodes and adds them to the survivors’ "more"', () => {
    const model = buildModel(star(3, 2), 5);
    expect(model.nodes.map((n) => n.id)).toEqual(['concept:focus', 'concept:a0', 'concept:a1', 'concept:a2', 'node:doc#ch00/p000']);
    expect(model.hidden).toBe(5);
    expect(model.edges.every((e) => model.nodes.some((n) => n.id === e.source) && model.nodes.some((n) => n.id === e.target))).toBe(true);
    expect(model.nodes.map((n) => n.more)).toEqual([0, 1, 2, 2, 0]);
  });

  it('never shows more than 150 nodes, whatever the budget', () => {
    expect(buildModel(star(40, 4), 999).nodes).toHaveLength(NODE_CAP);
  });

  it('keeps the server’s own "more" and truncation flag', () => {
    const data = star(1);
    data.truncated = true;
    data.nodes[1]!.more = 7;
    const model = buildModel(data);
    expect([model.truncated, model.nodes[1]!.more]).toEqual([true, 7]);
  });

  it('fans out parallel edges between the same pair into lanes around zero', () => {
    const model = buildModel(
      hood(
        [gnode('concept:f', 0), gnode('concept:a', 1)],
        [
          gedge('concept:f', 'concept:a', { id: 'x', weight: 3 }),
          gedge('concept:a', 'concept:f', { id: 'y', weight: 2, relation: 'contradicts' }),
          gedge('concept:f', 'concept:a', { id: 'z', weight: 1, relation: 'mentions' }),
        ],
      ),
    );
    expect(model.edges.map((e) => e.lane)).toEqual([-1, 0, 1]);
    expect(model.nodes.map((n) => n.degree)).toEqual([3, 3]);
  });

  it('drops self-loops and duplicate nodes', () => {
    const model = buildModel(hood([gnode('concept:f', 0), gnode('concept:f', 0)], [gedge('concept:f', 'concept:f')]));
    expect([model.nodes.length, model.edges.length]).toEqual([1, 0]);
  });
});

describe('nextBudget and neighbours', () => {
  it('grows by a step but never past the available nodes or the cap', () => {
    expect([nextBudget(60, 200), nextBudget(60, 80), nextBudget(140, 400)]).toEqual([105, 80, 150]);
  });

  it('finds a node’s visible neighbours, itself included', () => {
    const model = buildModel(star(2, 1));
    expect([...neighbours(model, 'concept:a0')].sort()).toEqual(['concept:a0', 'concept:focus', 'node:doc#ch00/p000']);
  });
});

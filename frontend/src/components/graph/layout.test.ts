import { describe, expect, it } from 'vitest';
import { star } from './fixtures';
import { createLayout, positionsOf, recentre, RING, settle } from './layout';
import { buildModel } from './model';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('static layout (reduced motion)', () => {
  const model = buildModel(star(6, 2));

  it('runs to convergence synchronously, with the focus pinned at the centre', () => {
    const layout = createLayout(model);
    const ticks = settle(layout);
    expect(ticks).toBeGreaterThan(50);
    expect(layout.simulation.alpha()).toBeLessThan(layout.simulation.alphaMin());
    expect(layout.byId.get('concept:focus')).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps rings apart: first-ring nodes sit nearer the focus than second-ring ones', () => {
    const layout = createLayout(model);
    settle(layout);
    const dist = (depth: number) => mean(layout.nodes.filter((n) => n.depth === depth).map((n) => Math.hypot(n.x, n.y)));
    expect(dist(1)).toBeLessThan(dist(2));
    expect(dist(1)).toBeGreaterThan(RING * 0.5);
    expect(layout.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });

  it('is deterministic for the same data', () => {
    const one = createLayout(model);
    const two = createLayout(model);
    settle(one);
    settle(two);
    expect(positionsOf(one)).toEqual(positionsOf(two));
  });
});

describe('re-focusing', () => {
  it('shifts known positions so the new focus is the origin', () => {
    const moved = recentre(new Map([['a', { x: 10, y: 5 }], ['b', { x: 30, y: -5 }]]), 'b');
    expect(moved).toEqual(new Map([['a', { x: -20, y: 10 }], ['b', { x: 0, y: 0 }]]));
  });

  it('starts carried-over nodes where they were', () => {
    const model = buildModel(star(2));
    const layout = createLayout(model, new Map([['concept:a1', { x: 42, y: -17 }]]));
    expect(layout.byId.get('concept:a1')).toMatchObject({ x: 42, y: -17 });
  });
});

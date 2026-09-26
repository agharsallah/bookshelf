import { describe, expect, it } from 'vitest';
import { positionsOf, settle } from '../graph/layout';
import { ids, shelf } from './fixtures';
import { DEFAULT_LENS } from './lens';
import { atlasKit, atlasRadius, bookHomes, createAtlasLayout, fitAll, homesOf } from './layout';
import { buildAtlasModel, indexAtlas } from './model';

const model = buildAtlasModel(indexAtlas(shelf()), DEFAULT_LENS).model;
const dist = (a?: { x: number; y: number }, b?: { x: number; y: number }) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN);

describe('atlas layout', () => {
  it('starts a concept shared by two books between their homes', () => {
    const [flow, talks] = shelf().nodes.map((n) => n.document?.id ?? '');
    const homes = homesOf(model, bookHomes([flow ?? '', talks ?? '']));
    const law = homes.get(ids.law);
    expect(law?.x).toBeCloseTo(0);
    expect(law?.y).toBeCloseTo(0);
    expect(homes.get(ids.queues)).toEqual(homes.get(ids.flow));
  });

  it('is deterministic', () => {
    const a = createAtlasLayout(model, new Map(), 'free');
    const b = createAtlasLayout(model, new Map(), 'free');
    settle(a);
    settle(b);
    expect(positionsOf(a)).toEqual(positionsOf(b));
  });

  it('grouped by book, keeps each book’s chapters closer to it than to the other book', () => {
    const layout = createAtlasLayout(model, new Map(), 'book');
    settle(layout);
    const at = (id: string) => layout.byId.get(id);
    expect(dist(at(ids.limits), at(ids.flow))).toBeLessThan(dist(at(ids.limits), at(ids.talks)));
    expect(dist(at(ids.stories), at(ids.talks))).toBeLessThan(dist(at(ids.stories), at(ids.flow)));
  });

  it('carries known positions over, so a filter change reflows rather than scatters', () => {
    const layout = createAtlasLayout(model, new Map([[ids.law, { x: 123, y: -45 }]]), 'free');
    expect(layout.byId.get(ids.law)).toMatchObject({ x: 123, y: -45 });
    expect(layout.simulation.alpha()).toBe(0.5);
  });

  it('draws better-connected concepts bigger, within a cap', () => {
    expect(atlasRadius({ kind: 'concept', degree: 16 })).toBeGreaterThan(atlasRadius({ kind: 'concept', degree: 1 }));
    expect(atlasRadius({ kind: 'concept', degree: 10_000 })).toBe(13);
  });

  it('frames every mark, and keeps one kit per grouping', () => {
    const layout = createAtlasLayout(model, new Map(), 'free');
    settle(layout);
    const cam = fitAll(layout, 800, 600);
    for (const n of layout.nodes) {
      const x = n.x * cam.k + cam.x;
      const y = n.y * cam.k + cam.y;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(600);
    }
    expect(atlasKit('book')).toBe(atlasKit('book'));
    expect(atlasKit('free')).not.toBe(atlasKit('book'));
  });
});

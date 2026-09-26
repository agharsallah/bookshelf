import { describe, expect, it } from 'vitest';
import { ids, shelf } from './fixtures';
import { indexAtlas } from './model';
import { hopCost, pathIds, shortestPath } from './paths';

const route = (from: string, to: string, atlas = shelf()) =>
  shortestPath(indexAtlas(atlas), from, to)?.map((h) => `${h.from.label} -${h.edge.relation}${h.forward ? '->' : '<-'} ${h.to.label}`);

describe('shortestPath', () => {
  it('walks ideas across books, reading each hop the way its line reads', () => {
    expect(route(ids.limits, ids.stories)).toEqual([
      'Limits -mentions-> wip limit',
      "wip limit -supports-> little's law",
      "little's law -mentions<- Stories",
    ]);
  });

  it('prefers a typed relation to a detour through shared vocabulary', () => {
    // Queues shares ideas with Stories directly, but through little's law the chain explains itself
    expect(route(ids.queues, ids.stories)).toEqual(["Queues -defines-> little's law", "little's law -mentions<- Stories"]);
  });

  it('does not cut through a book that contains everything', () => {
    const atlas = shelf();
    atlas.edges = atlas.edges.filter((e) => e.id !== 'd1' && e.id !== 'h1'); // Queues is now reachable by structure only
    expect(route(ids.limits, ids.queues, atlas)).toEqual(['Limits -contains<- Flow', 'Flow -contains-> Queues']);
    expect(route(ids.wip, ids.queues, atlas)?.length).toBe(3);
  });

  it('finds nothing between marks nothing joins, and an empty path from a mark to itself', () => {
    const atlas = shelf();
    atlas.nodes.push({ ...atlas.nodes[7]!, id: 'concept:island', label: 'island' });
    expect(route(ids.law, 'concept:island', atlas)).toBeUndefined();
    expect(shortestPath(indexAtlas(atlas), ids.law, ids.law)).toEqual([]);
  });

  it('charges proposed lines a premium, and weak lines more than strong ones', () => {
    const [line] = shelf().edges.filter((e) => e.id === 's1');
    expect(hopCost({ ...line!, status: 'proposed' })).toBeGreaterThan(hopCost(line!));
    expect(hopCost({ ...line!, weight: 0.2 })).toBeGreaterThan(hopCost(line!));
  });

  it('lights its marks and lines', () => {
    const hops = shortestPath(indexAtlas(shelf()), ids.queues, ids.wip) ?? [];
    expect([...pathIds(hops).nodes].sort()).toEqual([ids.law, ids.queues, ids.wip].sort());
    expect([...pathIds(hops).edges].sort()).toEqual(['d1', 's1']);
  });
});

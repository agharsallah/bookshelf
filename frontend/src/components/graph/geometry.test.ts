import { describe, expect, it } from 'vitest';
import { centerOn, controlPoint, edgeAt, nodeAt, quadAt, toScreen, toWorld, zoomAt, MAX_ZOOM, type HitEdge, type HitNode } from './geometry';

describe('camera', () => {
  const cam = { x: 100, y: 50, k: 2 };

  it('maps screen to world and back', () => {
    const world = toWorld({ x: 140, y: 90 }, cam);
    expect([world, toScreen(world, cam)]).toEqual([{ x: 20, y: 20 }, { x: 140, y: 90 }]);
  });

  it('zooms about the pointer, keeping the world point under it fixed, within limits', () => {
    const at = { x: 300, y: 200 };
    const before = toWorld(at, cam);
    const zoomed = zoomAt(cam, at, 1.25);
    expect(toWorld(at, zoomed)).toEqual(before);
    expect(zoomAt(cam, at, 100).k).toBe(MAX_ZOOM);
  });

  it('centres a world point in the viewport', () => {
    expect(toScreen({ x: 10, y: -10 }, centerOn({ x: 10, y: -10 }, 800, 600, 1.5))).toEqual({ x: 400, y: 300 });
  });
});

describe('nodeAt', () => {
  const nodes: HitNode[] = [
    { id: 'a', x: 0, y: 0, r: 8 },
    { id: 'b', x: 12, y: 0, r: 8 },
  ];

  it('picks the nearest node whose disc contains the point', () => {
    expect([nodeAt({ x: 4, y: 0 }, nodes), nodeAt({ x: 8, y: 0 }, nodes), nodeAt({ x: 0, y: 7.9 }, nodes)]).toEqual(['a', 'b', 'a']);
  });

  it('misses outside every disc unless the slop reaches it', () => {
    expect([nodeAt({ x: 0, y: 11 }, nodes), nodeAt({ x: 0, y: 11 }, nodes, 4)]).toEqual([null, 'a']);
  });
});

describe('edgeAt', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };
  const edges: HitEdge[] = [{ id: 'e', a, b, lane: 0 }];

  it('hits the drawn curve, not the straight chord', () => {
    const mid = quadAt(a, controlPoint(a, b, 0), b, 0.5);
    expect(Math.abs(mid.y)).toBeGreaterThan(3);
    expect([edgeAt(mid, edges, 2), edgeAt({ x: 50, y: 0 }, edges, 2)]).toEqual(['e', null]);
  });

  it('prefers the closer of two parallel edges', () => {
    const two: HitEdge[] = [
      { id: 'up', a, b, lane: -0.5 },
      { id: 'down', a, b, lane: 0.5 },
    ];
    const onDown = quadAt(a, controlPoint(a, b, 0.5), b, 0.5);
    expect(edgeAt(onDown, two, 6)).toBe('down');
  });
});

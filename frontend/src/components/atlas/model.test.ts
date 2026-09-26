import { describe, expect, it } from 'vitest';
import { ids, shelf, T } from './fixtures';
import { DEFAULT_LENS, type LensFilters } from './lens';
import { buildAtlasModel, indexAtlas, inPlay } from './model';

const index = indexAtlas(shelf());
const lens = (patch: Partial<LensFilters>): LensFilters => ({
  ...DEFAULT_LENS,
  mode: 'lens',
  ...patch,
});

describe('indexAtlas', () => {
  it('gives a concept the books of the chapters that name it', () => {
    expect([...(index.books.get(ids.law) ?? [])].sort()).toEqual([T, shelf().nodes[0]?.document?.id].sort());
    expect(index.books.get(ids.batch)?.size).toBe(0);
  });
});

describe('inPlay', () => {
  it('keeps everything in map mode, whatever the filters say', () => {
    const play = inPlay(index, {
      ...lens({ links: ['contradicts'] }),
      mode: 'map',
    });
    expect(play.nodes.size).toBe(8);
    expect(play.edges.size).toBe(9);
  });

  it('narrowed to one connection type, lights only what that type joins', () => {
    const play = inPlay(index, lens({ links: ['contradicts'] }));
    expect([...play.nodes].sort()).toEqual([ids.batch, ids.wip].sort());
    expect([...play.edges]).toEqual(['x1']);
  });

  it('cross-book only keeps ideas in two books and what links to them', () => {
    const play = inPlay(index, lens({ crossBook: true }));
    expect(play.nodes.has(ids.law)).toBe(true);
    expect(play.nodes.has(ids.wip)).toBe(false);
    expect(play.nodes.has(ids.stories)).toBe(true);
    expect(play.nodes.has(ids.limits)).toBe(false);
  });

  it('a book filter keeps that book, its chapters and the concepts they name', () => {
    const play = inPlay(index, lens({ books: [T] }));
    expect([...play.nodes].sort()).toEqual([ids.law, ids.stories, ids.talks].sort());
  });

  it('a kind filter drops books and chapters but keeps the concept-to-concept lines', () => {
    const play = inPlay(index, lens({ kinds: ['concept', 'framework'] }));
    expect([...play.nodes].sort()).toEqual([ids.batch, ids.law, ids.wip].sort());
    expect([...play.edges].sort()).toEqual(['s1', 'x1']);
  });

  it('a search lights the names that match and what they are joined to', () => {
    const play = inPlay(index, { ...DEFAULT_LENS, query: 'WIP' });
    expect([...play.nodes].sort()).toEqual([ids.batch, ids.law, ids.limits, ids.wip].sort());
    expect([...play.edges].sort()).toEqual(['m2', 's1', 'x1']);
  });
});

describe('buildAtlasModel', () => {
  it('dims by default: the model keeps everything and the lens says what is lit', () => {
    const view = buildAtlasModel(index, lens({ links: ['contradicts'] }));
    expect(view.model.nodes).toHaveLength(8);
    expect(view.lens?.nodes.has(ids.wip)).toBe(true);
    expect(view.lens?.nodes.has(ids.flow)).toBe(false);
    expect(view.shown).toEqual({ nodes: 2, edges: 1 });
  });

  it('hides instead when asked: only what is in play is laid out', () => {
    const view = buildAtlasModel(index, lens({ links: ['contradicts'], others: 'hide' }));
    expect(view.model.nodes.map((n) => n.id).sort()).toEqual([ids.batch, ids.wip].sort());
    expect(view.model.edges.map((e) => e.id)).toEqual(['x1']);
    expect(view.lens).toBeNull();
  });

  it('draws chapters as passages, captions them, and keeps structure lines thin', () => {
    const view = buildAtlasModel(index, DEFAULT_LENS);
    expect(view.lens).toBeNull();
    const queues = view.model.nodes.find((n) => n.id === ids.queues);
    expect(queues).toMatchObject({ kind: 'node', caption: 'Queues', depth: 1 });
    expect(view.model.edges.find((e) => e.id === 'c1')?.strength).toBe(0.5);
    expect(view.model.strongest).toBe(2); // defines × 2 passages; structure does not count
  });
});

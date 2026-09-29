import { describe, expect, it } from 'vitest';
import { NOT_READ } from '../library/progress';
import { collectionParam, genreSummary, moved, placeIn, readHref, upNext } from './path';

const a = { id: 'a', slug: 'lora', title: 'LoRA', genre: 'paper' as const };
const b = { id: 'b', slug: 'dl-book', title: 'Deep Learning', genre: 'book' as const };
const c = { id: 'c', slug: 'rlhf-post', title: 'RLHF, explained', genre: 'article' as const };

describe('placeIn', () => {
  it('knows the neighbours of a member, and nothing of a stranger', () => {
    expect(placeIn([a, b, c], 'b')).toEqual({ index: 1, total: 3, prev: a, next: c });
    expect(placeIn([a, b, c], 'a')).toMatchObject({ prev: null, next: b });
    expect(placeIn([a, b, c], 'c')).toMatchObject({ prev: b, next: null });
    expect(placeIn([a, b], 'z')).toBeNull();
  });
});

describe('upNext', () => {
  it('picks the first member not finished', () => {
    const finished = { ...NOT_READ, share: 1, lastRead: '2026-09-01' };
    const half = { ...NOT_READ, share: 0.5, lastRead: '2026-09-02' };
    expect(upNext([a, b, c], { lora: finished, 'dl-book': half })).toBe(b);
    expect(upNext([a, b, c], {})).toBe(a);
    expect(upNext([a], { lora: finished })).toBeNull();
  });
});

describe('genreSummary', () => {
  it('counts each genre in plain words', () => {
    expect(genreSummary([a, b, c])).toBe('a book, a paper and an article');
    expect(genreSummary([a, a, b])).toBe('a book and 2 papers');
    expect(genreSummary([c, c])).toBe('2 articles');
    expect(genreSummary([])).toBe('Nothing in it yet');
  });
});

describe('moved', () => {
  it('moves one item and clamps at the ends without touching the input', () => {
    const items = ['a', 'b', 'c'];
    expect(moved(items, 0, 1)).toEqual(['b', 'a', 'c']);
    expect(moved(items, 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moved(items, 0, -1)).toEqual(['a', 'b', 'c']);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});

describe('readHref and collectionParam', () => {
  it('keeps the collection in the reader URL, and reads back only a well-formed slug', () => {
    expect(readHref('lora', 'fine-tuning')).toBe('/documents/lora/read?collection=fine-tuning');
    expect(readHref('lora', 'fine-tuning', 'ch02/s01')).toBe('/documents/lora/read/ch02/s01?collection=fine-tuning');
    expect(collectionParam(new URLSearchParams('collection=fine-tuning'))).toBe('fine-tuning');
    expect(collectionParam(new URLSearchParams('collection=Fine Tuning'))).toBeNull();
    expect(collectionParam(new URLSearchParams(''))).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { NOT_READ } from '../library/progress';
import { collectionParam, genreSummary, inCollection, memberLabel, memberReading, memberShare, moved, placeIn, readHref, upNext } from './path';

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
  const at = (read: number, finished = false) => ({ read, readLabel: '', finished });

  it('picks the first member not finished', () => {
    expect(upNext([{ ...a, ...at(1) }, { ...b, ...at(0.5) }, { ...c, ...at(0) }])?.id).toBe('b');
    expect(upNext([{ ...a, ...at(0) }, { ...b, ...at(0) }])?.id).toBe('a');
    expect(upNext([{ ...a, ...at(1) }])).toBeNull();
  });

  it('counts a member marked finished as read through, whatever its positions say', () => {
    expect(upNext([{ ...a, ...at(0.88, true) }, { ...b, ...at(0.1) }])?.id).toBe('b');
    expect(memberShare(at(0.88, true))).toBe(1);
    expect(memberLabel({ read: 0.88, readLabel: '88% read', finished: true })).toBe('Finished');
    expect(memberLabel({ read: 0.88, readLabel: '88% read', finished: false })).toBe('88% read');
  });
});

describe('memberReading', () => {
  it('is finished only with a mark, not when the mark is missing', () => {
    const partway = { ...NOT_READ, share: 0.88, lastRead: '2026-10-01T00:00:00Z' };
    expect(memberReading(partway, '2026-10-02T00:00:00Z')).toEqual({ read: 0.88, readLabel: '88% read', finished: true });
    expect(memberReading(partway, null).finished).toBe(false);
    expect(memberReading(NOT_READ, undefined)).toEqual({ read: 0, readLabel: 'Not started', finished: false });
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

describe('inCollection', () => {
  it('keeps the collection on any link, and leaves it alone without one', () => {
    expect(inCollection('/documents/lora', 'fine-tuning')).toBe('/documents/lora?collection=fine-tuning');
    expect(inCollection('/documents/lora?tab=notes', 'fine-tuning')).toBe('/documents/lora?tab=notes&collection=fine-tuning');
    expect(inCollection('/documents/lora', null)).toBe('/documents/lora');
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

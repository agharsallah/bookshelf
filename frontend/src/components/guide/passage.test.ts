import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import { flatten } from '../../lib/documents/tree';
import { clearChapterCache, loadChapter, neighbours, sectionHeading, targetBlock, unitOfAnchor, type PassageUnit } from './passage';

const node = (anchor: string, kind: string, extra: Partial<TreeNode> = {}): TreeNode =>
  ({ id: anchor, anchor, kind, ordinal: 0, depth: anchor.split('/').length - 1, heading: null, text: 'x', page_from: null, page_to: null, meta: {}, children: [], ...extra }) as TreeNode;

const chapter = node('ch03', 'chapter', {
  heading: 'Decode',
  children: [
    node('ch03/p001', 'paragraph'),
    node('ch03/s01', 'section', { heading: 'Signal areas', children: [node('ch03/s01/p001', 'paragraph'), node('ch03/s01/p002', 'paragraph')] }),
  ],
});
const flat = flatten(chapter);
const units: PassageUnit[] = [
  { anchor: 'ch1', heading: 'One', label: '1' },
  { anchor: 'ch10', heading: 'Ten', label: '10' },
  { anchor: 'ch11', heading: 'Eleven', label: '11' },
];

describe('unitOfAnchor and neighbours', () => {
  it('finds the chapter segment-aware (ch1 never claims ch10)', () => {
    expect(unitOfAnchor(units, 'ch10/s02/p004')?.label).toBe('10');
    expect(unitOfAnchor(units, 'ch1')?.label).toBe('1');
    expect(unitOfAnchor(units, 'app01/p001')).toBeNull();
  });

  it('gives the chapters either side, none past the ends', () => {
    expect(neighbours(units, units[1]!)).toEqual({ previous: units[0], next: units[2] });
    expect(neighbours(units, units[0]!).previous).toBeNull();
    expect(neighbours(units, units[2]!).next).toBeNull();
  });
});

describe('targetBlock and sectionHeading', () => {
  it('points at the cited block, or the first block under a cited section', () => {
    expect(targetBlock(flat, 'ch03/s01/p002')).toBe('ch03/s01/p002');
    expect(targetBlock(flat, 'ch03/s01')).toBe('ch03/s01');
    expect(targetBlock(flat, 'ch03/s09/p001')).toBeNull();
  });

  it("names the cited block's section, and nothing for the chapter's intro", () => {
    expect(sectionHeading(flat, 'ch03/s01/p001')).toBe('Signal areas');
    expect(sectionHeading(flat, 'ch03/p001')).toBeNull();
  });
});

describe('loadChapter', () => {
  beforeEach(() => clearChapterCache());

  it('fetches a chapter once and serves it from memory after', async () => {
    const api = { get: vi.fn().mockResolvedValue({ node: chapter, truncated: false }) };
    const first = await loadChapter('book', 'ch03', api as never);
    await loadChapter('book', 'ch03', api as never);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('nodes/book/ch03');
    expect(first.flat.map((f) => f.node.anchor)).toEqual(['ch03/p001', 'ch03/s01', 'ch03/s01/p001', 'ch03/s01/p002']);
  });

  it('forgets a failed load so the next open retries', async () => {
    const api = { get: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue({ node: chapter, truncated: false }) };
    await expect(loadChapter('book', 'ch03', api as never)).rejects.toThrow('down');
    await expect(loadChapter('book', 'ch03', api as never)).resolves.toMatchObject({ truncated: false });
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import { stripSegments } from './chapter-strip';

const unit = (anchor: string, from: number | null, to: number | null, meta: TreeNode['meta'] = {}) =>
  ({ anchor, heading: `Heading ${anchor}`, page_from: from, page_to: to, meta, children: [] }) as unknown as TreeNode;
const at = (unit: string, anchor: string, progress: number) => ({ unit, anchor, progress, updated_at: '2026-09-26T12:00:00Z' });

describe('stripSegments', () => {
  const units = [unit('front', 1, 10, { front_matter: true }), unit('ch01', 11, 40), unit('ch02', 41, 100), unit('ch03', null, null)];

  it('sizes each chapter by its pages (one page when it has none), summing to the whole strip', () => {
    const shares = stripSegments('m', units, {}).map((s) => s.share);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(shares[2]! / shares[1]!).toBeCloseTo(2);
    expect(shares[3]! / shares[0]!).toBeCloseTo(0.1);
  });

  it('fills what you read, opens a started chapter at your place and a finished one from its start', () => {
    const [, ch01, ch02, ch03] = stripSegments('m', units, { ch01: at('ch01', 'ch01/p9', 1), ch02: at('ch02', 'ch02/s1/p4', 0.4) }, 'ch02');
    expect([ch01?.finished, ch01?.progress, ch01?.href]).toEqual([true, 1, '/documents/m/read/ch01']);
    expect([ch02?.progress, ch02?.href, ch02?.current]).toEqual([0.4, '/documents/m/read/ch02/s1/p4', true]);
    expect([ch03?.progress, ch03?.current, ch03?.href]).toEqual([0, false, '/documents/m/read/ch03']);
  });

  it('names chapters by number and heading, front matter by heading only', () => {
    const [front, ch01] = stripSegments('m', units, {});
    expect([front?.title, front?.front, ch01?.title]).toEqual(['Heading front', true, '1 · Heading ch01']);
  });
});

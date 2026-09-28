import { describe, expect, it } from 'vitest';
import type { ClaimMark } from '../../../lib/api/types/paperStudy';
import { claimMarkLabel, claimMarksByBlock, hasVerdicts } from './claimMarks';

const claim = (id: string, key = id.toUpperCase()) => ({ id, key, strength: 'measured' as const });
const mark = (anchor: string, claims: ReturnType<typeof claim>[], counts: Partial<Pick<ClaimMark, 'supported_by' | 'contradicted_by' | 'extended_by'>> = {}): ClaimMark => ({
  anchor,
  claims,
  supported_by: 0,
  contradicted_by: 0,
  extended_by: 0,
  ...counts,
});

const drawn = new Set(['ch04', 'ch04/s02', 'ch04/s02/p001', 'ch04/s02/t001']);

describe('claimMarksByBlock', () => {
  it('puts each mark on its block', () => {
    const blocks = claimMarksByBlock([mark('ch04/s02/t001', [claim('c2')], { supported_by: 1, contradicted_by: 2 })], drawn);
    expect([...blocks.keys()]).toEqual(['ch04/s02/t001']);
    expect(blocks.get('ch04/s02/t001')).toMatchObject({ claims: [{ key: 'C2' }], supported_by: 1, contradicted_by: 2, extended_by: 0 });
  });

  it('moves an anchor that is not drawn to its nearest drawn ancestor, and drops one with none', () => {
    const blocks = claimMarksByBlock([mark('ch04/s02/p009', [claim('c1')]), mark('ch09/p001', [claim('c5')])], drawn);
    expect([...blocks.keys()]).toEqual(['ch04/s02']);
  });

  it('merges marks meeting on one block, counting a claim met twice once', () => {
    const blocks = claimMarksByBlock(
      [
        mark('ch04/s02/p004', [claim('c1')], { supported_by: 1 }),
        mark('ch04/s02/p005', [claim('c1')], { supported_by: 1 }),
        mark('ch04/s02/p006', [claim('c3')], { extended_by: 2 }),
      ],
      drawn,
    );
    expect(blocks.get('ch04/s02')).toMatchObject({ claims: [{ key: 'C1' }, { key: 'C3' }], supported_by: 1, extended_by: 2 });
  });
});

describe('claim mark wording', () => {
  it('names the claims and the shelf verdicts in a sentence', () => {
    const [block] = [...claimMarksByBlock([mark('ch04', [claim('c2'), claim('c3')], { supported_by: 1, contradicted_by: 2, extended_by: 1 })], drawn).values()];
    expect(claimMarkLabel(block!)).toBe('Claims C2, C3: supported by 1, contradicted by 2 and extended by 1 on your shelf');
    expect(hasVerdicts(block!)).toBe(true);
  });

  it('says when nothing on the shelf relates yet', () => {
    const [block] = [...claimMarksByBlock([mark('ch04', [claim('c2')])], drawn).values()];
    expect(claimMarkLabel(block!)).toBe('Claim C2: nothing on your shelf relates to it yet');
    expect(hasVerdicts(block!)).toBe(false);
  });
});

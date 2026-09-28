import { describe, expect, it } from 'vitest';
import type { PassageUnit } from '../guide/passage';
import { paperCiteLabel, unitNumbers } from './cite-label';

const unit = (anchor: string, heading: string): PassageUnit => ({ anchor, heading, label: anchor });

// BERT as parsed: the abstract is ch01, so "3 BERT" is ch04 and appendix A is ch10.
const BERT = [
  unit('ch01', 'Abstract'),
  unit('ch02', '1 Introduction'),
  unit('ch04', '3 BERT'),
  unit('ch09', 'Appendix for “BERT: Pre-training of Deep Bidirectional Transformers”'),
  unit('ch10', 'A Additional Details for BERT'),
  unit('ch11', 'B Detailed Experimental Setup'),
];

describe('paperCiteLabel', () => {
  const label = paperCiteLabel(BERT);

  it('labels a cite with the section number the paper prints, not the anchor position', () => {
    expect(label('ch04/s01/p003')).toBe('3.1 ¶3');
    expect(label('ch04/p005')).toBe('3 ¶5');
    expect(label('ch04')).toBe('3');
    expect(label('ch02/l001')).toBe('1.1');
  });

  it('uses appendix letters', () => {
    expect(label('ch10/s02/p001')).toBe('A.2 ¶1');
    expect(label('ch11/s01/f001')).toBe('B.1.1');
  });

  it('names a short unnumbered unit, else keeps the anchor label', () => {
    expect(label('ch01/p002')).toBe('Abstract ¶2');
    expect(label('ch09/p001')).toBe('9 ¶1');
    expect(label('fm01/p001')).toBe('1 ¶1');
  });
});

describe('unitNumbers', () => {
  it('reads a leading capital as a letter only when the units letter A, B, … in order', () => {
    expect(unitNumbers([unit('ch01', 'A Study of Loops'), unit('ch02', '2 Method')])).toEqual(
      new Map([['ch02', '2']]),
    );
  });
});

import { describe, expect, it } from 'vitest';
import type { ClaimRelationCounts, PaperClaims } from '../../lib/api/types/paperStudy';
import { claimGroups, groupDraftClaims, hasRelations, relationPhrase, relationSummary, relationTotals, unitHeading } from './claims';
import type { DraftClaim } from './extract-bodies';

const counts = (over: Partial<ClaimRelationCounts> = {}): ClaimRelationCounts => ({
  supported_by: 0,
  contradicted_by: 0,
  extended_by: 0,
  supports: 0,
  extends: 0,
  proposed: 0,
  ...over,
});

const draft = (key: string, cites: string[]): DraftClaim => ({ key, text: `Claim ${key}`, kind: 'result', strength: 'measured', cites });

const units = [
  { anchor: 'fm01', heading: 'Abstract', label: 'fm01' },
  { anchor: 'ch03', heading: 'Method', label: '3' },
  { anchor: 'ch04', heading: 'Experiments', label: '4' },
];

describe('groupDraftClaims', () => {
  it('groups a draft’s claims by the unit of their first cite, in reading order', () => {
    const groups = groupDraftClaims([draft('C1', ['ch04/p001']), draft('C2', ['ch03/s01/p002', 'ch04/p001']), draft('C3', ['ch04/s02/t001'])], units);
    expect(groups.map((g) => [g.heading, g.claims.map((c) => c.key)])).toEqual([
      ['3 Method', ['C2']],
      ['4 Experiments', ['C1', 'C3']],
    ]);
    expect(groups[0]?.claims[0]).toMatchObject({ id: null, relations: null });
  });

  it('skips cites outside every unit and puts claims with none first', () => {
    const groups = groupDraftClaims([draft('C1', ['zz01/p001', 'ch03/p001']), draft('C2', ['zz09'])], units);
    expect(groups.map((g) => [g.unit, g.claims.map((c) => c.key)])).toEqual([
      [null, ['C2']],
      ['ch03', ['C1']],
    ]);
  });
});

describe('claimGroups', () => {
  it('keeps the API’s groups with their relation counts and numbers chapter headings', () => {
    const data: PaperClaims = {
      document_id: 'd1',
      artifact_id: 'a1',
      total: 1,
      units: [
        { unit: null, heading: null, role: null, claims: [] },
        {
          unit: 'ch04',
          heading: 'Experiments',
          role: 'experiments',
          claims: [
            {
              id: 'c1',
              document_id: 'd1',
              artifact_id: 'a1',
              key: 'C2',
              text: 't',
              kind: 'result',
              strength: 'measured',
              evidence: ['ch04/p001'],
              unit: 'ch04',
              relations: counts({ supported_by: 1 }),
            },
          ],
        },
      ],
    };
    const groups = claimGroups(data);
    expect(groups.map((g) => g.heading)).toEqual(['4 Experiments']);
    expect(groups[0]?.claims[0]).toMatchObject({ id: 'c1', evidence: ['ch04/p001'], relations: { supported_by: 1 } });
  });
});

describe('unitHeading', () => {
  it('keeps a paper heading that prints its own number instead of prefixing the chapter position', () => {
    expect(unitHeading('ch04', '3 BERT')).toBe('3 BERT');
    expect(unitHeading('ch10', 'A Additional Details for BERT')).toBe('A Additional Details for BERT');
    expect(unitHeading('ch04', 'Experiments')).toBe('4 Experiments');
  });
});

describe('relation words', () => {
  it('says how the shelf bears on a claim, leaving out what is zero', () => {
    expect(relationSummary(counts({ supported_by: 1, contradicted_by: 2 }))).toBe('supported by 1 · contradicted by 2 on your shelf');
    expect(relationSummary(counts({ extended_by: 3 }))).toBe('extended by 3 on your shelf');
    expect(relationSummary(counts({ proposed: 2 }))).toBeNull();
    expect(relationSummary(null)).toBeNull();
  });

  it('opens a claim whenever anything relates to it, proposed relations included', () => {
    expect(hasRelations(counts())).toBe(false);
    expect(hasRelations(counts({ proposed: 1 }))).toBe(true);
    expect(hasRelations(counts({ supports: 1 }))).toBe(true);
    expect(hasRelations(null)).toBe(false);
  });

  it('reads each relation from the claim asked about', () => {
    expect(relationPhrase({ relation: 'supports', direction: 'in' })).toEqual({ text: 'Supported by', tone: 'support' });
    expect(relationPhrase({ relation: 'supports', direction: 'out' }).text).toBe('Supports');
    expect(relationPhrase({ relation: 'contradicts', direction: 'out' })).toEqual({ text: 'Contradicted by', tone: 'contradict' });
    expect(relationPhrase({ relation: 'extends', direction: 'in' }).text).toBe('Extended by');
  });

  it('totals the counts over every claim, drafts counting nothing', () => {
    const groups = [
      { unit: 'ch03', heading: '', claims: [{ id: 'a', key: 'C1', text: '', kind: 'method' as const, strength: 'argued' as const, evidence: [], relations: counts({ supported_by: 1, proposed: 1 }) }] },
      {
        unit: 'ch04',
        heading: '',
        claims: [
          { id: 'b', key: 'C2', text: '', kind: 'result' as const, strength: 'measured' as const, evidence: [], relations: counts({ supported_by: 2, contradicted_by: 1 }) },
          { id: null, key: 'C3', text: '', kind: 'result' as const, strength: 'measured' as const, evidence: [], relations: null },
        ],
      },
    ];
    expect(relationTotals(groups)).toEqual(counts({ supported_by: 3, contradicted_by: 1, proposed: 1 }));
  });
});

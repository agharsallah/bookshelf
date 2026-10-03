import { describe, expect, it } from 'vitest';
import { cardedIds, citedLine, planksByYear, shelfTally, SPINE_CEILING, SPINE_FLOOR, spineHeight, spineTitle, tallyLine } from './bookcase';
import { artifactState, paperDetail, rating } from './fixtures';

describe('spineHeight', () => {
  it('stands uncited and unknown papers at the floor', () => {
    expect(spineHeight(null)).toBe(SPINE_FLOOR);
    expect(spineHeight(0)).toBe(SPINE_FLOOR);
  });

  it('grows with citations on a log scale, never past the ceiling', () => {
    const ten = spineHeight(10);
    const thousand = spineHeight(1000);
    expect(ten).toBeGreaterThan(SPINE_FLOOR);
    expect(thousand).toBeGreaterThan(ten);
    // Log scale: 10 → 1000 adds about as much as 1000 → 100k.
    expect(thousand - ten).toBeCloseTo(spineHeight(100_000) - thousand, 0);
    expect(spineHeight(5_000_000)).toBe(SPINE_CEILING);
  });
});

describe('spineTitle', () => {
  it('keeps the name before a colon', () => {
    expect(spineTitle('LEGO-RL: Harness-Native Reinforcement Learning')).toBe('LEGO-RL');
  });

  it('keeps the whole title when there is no short name', () => {
    expect(spineTitle('Attention  Is All You Need')).toBe('Attention Is All You Need');
    expect(spineTitle(`${'A very long lead-in that is not a name at all'}: and more`)).toContain('and more');
  });
});

describe('planksByYear', () => {
  it('puts the newest year on top and undated papers on the bottom plank, keeping order within', () => {
    const papers = [
      paperDetail({ id: 'a', year: 2023 }),
      paperDetail({ id: 'b', year: null }),
      paperDetail({ id: 'c', year: 2025 }),
      paperDetail({ id: 'd', year: 2023 }),
    ];
    expect(planksByYear(papers).map((p) => [p.year, p.papers.map((x) => x.id)])).toEqual([
      [2025, ['c']],
      [2023, ['a', 'd']],
      [null, ['b']],
    ]);
  });
});

describe('shelfTally', () => {
  it('counts started, rated and carded papers and each verdict', () => {
    const tally = shelfTally(
      [
        paperDetail({ id: 'a', highest_pass: 2, rating: rating({ verdict: 'must_read' }) }),
        paperDetail({ id: 'b', rating: rating({ verdict: null }) }),
        paperDetail({ id: 'c' }),
      ],
      new Set(['a', 'c', 'gone']),
    );
    expect(tally).toEqual({ total: 3, started: 1, rated: 2, carded: 2, verdicts: { must_read: 1, useful: 0, skim: 0, skip: 0 } });
  });
});

describe('tallyLine', () => {
  it('reads as one sentence', () => {
    const base = { verdicts: { must_read: 0, useful: 0, skim: 0, skip: 0 } };
    expect(tallyLine({ ...base, total: 47, started: 0, rated: 0, carded: 40 })).toBe('47 papers: none started, none rated, 40 with a card.');
    expect(tallyLine({ ...base, total: 1, started: 1, rated: 1, carded: 0 })).toBe('1 paper: 1 started, 1 rated, 0 with a card.');
  });
});

describe('citedLine', () => {
  it('says how often a paper is cited, or nothing when unknown', () => {
    expect(citedLine(null)).toBe('');
    expect(citedLine(0)).toBe('Not cited yet');
    expect(citedLine(1)).toBe('Cited once');
    expect(citedLine(45994)).toBe('Cited 45,994 times');
  });
});

describe('cardedIds', () => {
  it('counts a card waiting for review, not a rejected one', () => {
    const papers = [
      paperDetail({ id: 'a', artifacts: [artifactState({ review: 'draft' })] }),
      paperDetail({ id: 'b', artifacts: [artifactState({ review: 'rejected' })] }),
      paperDetail({ id: 'c', artifacts: [artifactState({ type: 'claim_set' })] }),
    ];
    expect([...cardedIds(papers)]).toEqual(['a']);
  });
});

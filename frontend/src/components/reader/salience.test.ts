import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { LexTerm } from './lexicon';
import type { Panes, PaneEntry } from './panes';
import { buildSalience, citeWeights, findTerms, salientRuns, sentences, termPattern, type Salient } from './salience';

function node(anchor: string, text: string, kind: TreeNode['kind'] = 'paragraph'): TreeNode {
  return { id: anchor, anchor, kind, ordinal: 0, depth: 2, heading: null, text, page_from: 1, page_to: 1, meta: {}, children: [] };
}

const term = (label: string, extra: Partial<LexTerm> = {}): LexTerm => ({ label, forms: [label.toLowerCase()], kind: 'concept', gloss: null, defines: [], ...extra });

const entry = (blocks: PaneEntry['blocks']): PaneEntry => ({ id: 'x', anchor: 'ch01', type: 'chapter_distillation', standing: 'approved', version: 1, origin: 'skill', title: null, blocks });
const cite = (...anchors: string[]) => ({ type: 'paragraph' as const, spans: [{ text: 'claim', cites: anchors }] });

describe('findTerms', () => {
  const patterns = (terms: LexTerm[]) => new Map(terms.map((t) => [t, termPattern(t)]));

  it('matches whole words, any case, with a plural; the longer of two overlapping terms wins', () => {
    const wip = term('work in progress');
    const limit = term('work in progress limit');
    const found = findTerms('Set Work in progress limits early; slack helps.', patterns([wip, limit]));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ term: limit, start: 4, end: 27 });
    expect(findTerms('Slackers are not slack.', patterns([term('slack')]))).toMatchObject([{ start: 17, end: 22 }]);
    // Spaces inside a term match any run of whitespace, line breaks included.
    expect(findTerms('work in\nprogress', patterns([wip]))).toMatchObject([{ start: 0, end: 16 }]);
  });
});

describe('sentences', () => {
  it('splits on sentence ends and never across a line (list items), trimming spaces and markers', () => {
    const text = 'First idea here. Second one!\n- An item without a stop\n- Another';
    expect(sentences(text).map((s) => text.slice(s.start, s.end))).toEqual(['First idea here.', 'Second one!', 'An item without a stop', 'Another']);
  });
});

describe('citeWeights', () => {
  it('counts every cite in the distillation and section notes, and collects the summary cites apart', () => {
    const panes: Panes = {
      distillation: entry([cite('a', 'b'), cite('a'), { type: 'quote', text: 'q', cites: ['c'] } as PaneEntry['blocks'][number]]),
      summary: entry([cite('b')]),
      sections: [entry([cite('a')])],
      figures: [],
    };
    const weights = citeWeights(panes);
    expect(Object.fromEntries(weights.notes)).toEqual({ a: 3, b: 1, c: 1 });
    expect([...weights.summary]).toEqual(['b']);
  });
});

describe('buildSalience', () => {
  const slack = term('slack', { gloss: 'Unplanned capacity.', defines: ['ch01/p003'] });
  const blocks = [
    node('ch01/p001', 'Queues grow quietly. Nobody notices until the waiting starts to hurt the team.'),
    node('ch01/p002', 'A short aside with nothing cited in it at all, just colour and rhythm.'),
    node('ch01/p003', 'Slack helps. Slack is capacity you leave unplanned so surprises do not queue.'),
    node('ch01/p004', 'Teams at full load wait longest, because every surprise lands in a queue.'),
    node('ch01/p005', 'Filler text for the chapter so the share of marked blocks stays small here.'),
  ];
  const weights = { notes: new Map([['ch01/p001', 2], ['ch01/p004', 1]]), summary: new Set(['ch01/p004']) };

  const build = () => buildSalience(blocks, [slack], weights);
  const text = (s: Salient) => blocks.find((b) => b.anchor === s.anchor)?.text?.slice(s.start, s.end);

  it('marks the most-cited blocks: the summary and definitions weigh most, the top third are core ideas', () => {
    const ideas = build().filter((s) => s.tier !== 'term');
    // Five text blocks → one sentence (20%); the summary-cited block outranks two plain cites.
    expect(ideas).toHaveLength(1);
    expect(ideas[0]).toMatchObject({ anchor: 'ch01/p004', tier: 'core', title: 'Core idea', source: 'heuristic' });
    expect(ideas[0]?.why).toBe('The chapter summary rests on it · 1 claim in the notes cites it');
  });

  it('picks the sentence with the most terms and a definition, skipping fragments too short to be a claim', () => {
    const ten = [...blocks, ...blocks.map((b) => ({ ...b, anchor: `${b.anchor}x` }))];
    const marks = buildSalience(ten, [slack], { notes: new Map(), summary: new Set(['ch01/p003']) });
    const idea = marks.find((s) => s.anchor === 'ch01/p003' && s.tier !== 'term');
    expect(idea && text(idea)).toBe('Slack is capacity you leave unplanned so surprises do not queue.');
    expect(idea?.why).toContain('It defines slack');
  });

  it('marks each term once: in the block that defines it rather than at an earlier mention', () => {
    const early = [node('ch01/p000', 'We will get to slack later on in this chapter, promise.'), ...blocks];
    const terms = buildSalience(early, [slack], weights).filter((s) => s.tier === 'term');
    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({ anchor: 'ch01/p003', start: 0, end: 5, title: 'Slack', gloss: 'Unplanned capacity.', why: 'Concept · defined here' });
  });

  it('returns the marks in reading order, with ids stable for the same text', () => {
    const marks = build();
    expect(marks.map((s) => s.id)).toEqual(['ch01/p003@0', 'ch01/p004@0']);
    expect(build()).toEqual(marks);
  });

  it('marks nothing where the notes cite nothing and no term appears', () => {
    expect(buildSalience(blocks, [], { notes: new Map(), summary: new Set() })).toEqual([]);
  });
});

describe('salientRuns', () => {
  const s = (id: string, start: number, end: number, tier: Salient['tier']): Salient => ({ id, anchor: 'a', start, end, tier, title: '', why: '', gloss: null, source: 'heuristic' });

  it('cuts a run at every mark boundary and tells the sentence from the term inside it', () => {
    const sentence = s('s', 5, 30, 'key');
    const t = s('t', 10, 15, 'term');
    expect(salientRuns(0, 40, [sentence, t])).toEqual([
      { start: 0, end: 5, sentence: null, term: null },
      { start: 5, end: 10, sentence, term: null },
      { start: 10, end: 15, sentence, term: t },
      { start: 15, end: 30, sentence, term: null },
      { start: 30, end: 40, sentence: null, term: null },
    ]);
  });

  it('keeps a run whole when no mark touches it, and clips marks to the run', () => {
    expect(salientRuns(0, 4, [s('x', 10, 20, 'core')])).toEqual([{ start: 0, end: 4, sentence: null, term: null }]);
    expect(salientRuns(12, 16, [s('x', 10, 20, 'core')]).map((r) => [r.start, r.end, r.sentence?.id])).toEqual([[12, 16, 'x']]);
  });
});

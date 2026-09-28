import { describe, expect, it } from 'vitest';
import type { TreeNode } from '../../lib/api/types/documents';
import type { GradedIdea, RecallGrade, RecallPublic } from '../../lib/api/types/recalls';
import { byStatus, canGrade, gapMarks, hasPrediction, latestGraded, tally } from './grade';

function node(anchor: string, text: string): TreeNode {
  return { id: anchor, anchor, kind: 'paragraph', ordinal: 0, depth: 1, heading: null, text, page_from: 1, page_to: 1, meta: {}, children: [] };
}

function idea(id: string, status: GradedIdea['status'], text: string, cite: string): GradedIdea {
  return { id, tier: 'key', text, why: null, cites: [cite], status, feedback: `About ${id}.` };
}

function grade(ideas: GradedIdea[]): RecallGrade {
  return { ideas, question: null, comparison: null, prediction_id: null, origin: 'skill:grade-recall@1', model: null, created_at: '2026-09-28T00:00:00Z' };
}

const nodes = [node('ch01/p001', 'Teams run hot. Slack absorbs surprises.'), node('ch01/p002', 'Queues grow quietly.')];

describe('tally and byStatus', () => {
  it('counts each status and lists missed ideas first', () => {
    const g = grade([idea('I1', 'recalled', 'a', 'ch01/p001'), idea('I2', 'missed', 'b', 'ch01/p002'), idea('I3', 'partial', 'c', 'ch01/p001')]);
    expect(tally(g)).toEqual({ recalled: 1, partial: 1, missed: 1, total: 3 });
    expect(byStatus(g).map(([status, ideas]) => [status, ideas.map((i) => i.id)])).toEqual([
      ['missed', ['I2']],
      ['partial', ['I3']],
      ['recalled', ['I1']],
    ]);
  });
});

describe('gapMarks', () => {
  it('marks a verbatim idea where it stands, missed as core and partial as key, in reading order', () => {
    const g = grade([
      idea('I1', 'partial', 'Queues grow quietly.', 'ch01/p002'),
      idea('I2', 'missed', 'Slack absorbs surprises.', 'ch01/p001'),
      idea('I3', 'recalled', 'Teams run hot.', 'ch01/p001'),
    ]);
    const marks = gapMarks(g, nodes);
    expect(marks.map((m) => [m.anchor, m.tier, m.start, m.end, m.source])).toEqual([
      ['ch01/p001', 'core', 'Teams run hot. '.length, nodes[0]!.text!.length, 'recall'],
      ['ch01/p002', 'key', 0, 'Queues grow quietly.'.length, 'recall'],
    ]);
    expect(marks[0]?.why).toBe('About I2.');
  });

  it('marks the whole cited passage when the idea is the distillation’s own words', () => {
    const marks = gapMarks(grade([idea('I1', 'missed', 'Waiting is the cost of busyness.', 'ch01/p002')]), nodes);
    expect(marks.map((m) => [m.start, m.end])).toEqual([[0, 'Queues grow quietly.'.length]]);
  });

  it('skips ideas whose passage is not in this chapter', () => {
    expect(gapMarks(grade([idea('I1', 'missed', 'x', 'ch09/p001')]), nodes)).toEqual([]);
  });
});

describe('canGrade', () => {
  it('needs a distillation or salience marks that are more than terms', () => {
    const term = { id: 't', anchor: 'ch01/p001', start: 0, end: 5, tier: 'term' as const, title: 'Slack', why: '', gloss: null, source: 'model' as const };
    expect(canGrade({ distillation: null }, null)).toBe(false);
    expect(canGrade({ distillation: null }, [term])).toBe(false);
    expect(canGrade({ distillation: null }, [{ ...term, tier: 'core' }])).toBe(true);
    expect(canGrade({ distillation: {} as never }, null)).toBe(true);
  });
});

describe('recall lists', () => {
  const at = (id: string, kind: RecallPublic['kind'], graded: boolean): RecallPublic => ({
    id, unit: 'ch01', kind, raw: id, created_at: '2026-09-28T00:00:00Z', grade: graded ? grade([]) : null,
  });

  it('finds the newest graded recall and any prediction', () => {
    const list = [at('r3', 'recall', false), at('r2', 'recall', true), at('p1', 'prediction', false)];
    expect(latestGraded(list)?.id).toBe('r2');
    expect(hasPrediction(list)).toBe(true);
    expect(hasPrediction([at('r1', 'recall', true)])).toBe(false);
  });
});

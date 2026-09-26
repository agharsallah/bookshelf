import { describe, expect, it } from 'vitest';
import type { JobPublic } from '../../lib/api/types/jobs';
import { compactAnchors, errorSignature, groupFailures, runAll } from './failures';

function failed(overrides: Partial<JobPublic> = {}): JobPublic {
  return {
    id: 'j1', kind: 'distil_chapter', document_id: 'd1', anchor: 'ch24', skill: null, skill_version: null, state: 'failed', attempts: 1,
    error: 'cannot select inputs: ch24 is inside a skipped container', result: null, run_mode: null, duration_ms: null,
    created_at: '2026-09-26T11:00:00Z', started_at: null, finished_at: '2026-09-26T11:03:35Z',
    ...overrides,
  };
}

describe('errorSignature', () => {
  it('gives the same signature whichever chapter the error names', () => {
    expect(errorSignature('cannot select inputs: ch24 is inside a skipped container')).toBe(
      errorSignature('cannot select inputs: ch28/s02 is inside a skipped container'),
    );
    expect(errorSignature('cannot select inputs: ch24 is inside a skipped container')).toBe(
      'cannot select inputs: ‹anchor› is inside a skipped container',
    );
  });

  it('replaces inline data, quoted values, numbers and ids, and says a repeated clause once', () => {
    const a = "output rejected after one retry: schema: blocks/2: Additional properties are not allowed ('cites' was unexpected); schema: blocks/6: Additional properties are not allowed ('cites' was unexpected)";
    const b = "output rejected after one retry: schema: blocks/13: Additional properties are not allowed ('title' was unexpected)";
    expect(errorSignature(a)).toBe(errorSignature(b));
    expect(errorSignature(a)).toBe('output rejected after one retry: schema: blocks/N: Additional properties are not allowed (‘…’ was unexpected)');

    const nested = "schema: blocks/0: {'type': 'paragraph', 'text': \"can't [see] {this}\", 'cites': ['ch04/f005']} is not valid under any of the given schemas";
    expect(errorSignature(nested)).toBe('schema: blocks/N: {…} is not valid under any of the given schemas');
    expect(errorSignature('job 3f2a9c1e-0b7d-4e21-9a55-1c2d3e4f5a6b not found')).toBe('job ‹id› not found');
  });

  it('closes data an error message cut off, and keeps different causes apart', () => {
    expect(errorSignature("schema: blocks/0: {'type': 'table', 'rows': [['PM")).toBe('schema: blocks/N: {…}');
    const long = `{'type': 'paragraph', 'text': '${'x'.repeat(290)}'}`;
    expect(errorSignature(`schema: blocks/0: ${long} is no`)).toBe(errorSignature(`schema: blocks/3: ${long} is not valid und`));
    expect(errorSignature(`schema: blocks/0: ${long} is no`)).toBe('schema: blocks/N: {…}');
    expect(errorSignature('reply is not valid JSON: at char 12')).not.toBe(errorSignature('reply timed out after 12 s'));
  });

  it('reads only the first line, and names a missing error', () => {
    expect(errorSignature('boom at ch03\nTraceback (most recent call last):')).toBe('boom at ‹anchor›');
    expect(errorSignature(null)).toBe('Failed without an error message');
  });
});

describe('groupFailures', () => {
  it('groups by cause, newest group first, each listing its kinds, documents and anchors', () => {
    const groups = groupFailures([
      failed({ id: 'a', anchor: 'ch24', finished_at: '2026-09-26T11:03:35Z', error: 'cannot select inputs: ch24 is inside a skipped container' }),
      failed({ id: 'old', kind: 'describe_figure', anchor: 'ch14/f001', finished_at: '2026-09-24T18:12:03Z', error: 'reply is not valid JSON: char 216' }),
      failed({ id: 'b', kind: 'distil_section', anchor: 'ch26', finished_at: '2026-09-26T11:03:40Z', error: 'cannot select inputs: ch26 is inside a skipped container' }),
      failed({ id: 'c', anchor: 'ch26', document_id: 'd2', finished_at: '2026-09-26T11:01:00Z', error: 'cannot select inputs: ch26 is inside a skipped container' }),
    ]);

    expect(groups.map((g) => g.jobs.map((j) => j.id))).toEqual([['b', 'a', 'c'], ['old']]);
    expect(groups[0]).toMatchObject({
      kinds: ['distil_section', 'distil_chapter'],
      documentIds: ['d1', 'd2'],
      anchors: ['ch26', 'ch24'],
      latest: '2026-09-26T11:03:40Z',
    });
  });
});

describe('compactAnchors', () => {
  it('writes chapter runs as ranges and the rest as labels, in book order', () => {
    expect(compactAnchors(['ch27', 'ch24', 'ch25', 'ch26', 'ch05', 'ch14/f001', 'ch09'])).toBe('5, 9, 14.1, 24–27');
  });

  it('stops after a few items', () => {
    expect(compactAnchors(['ch01/f001', 'ch02/f001', 'ch03/f001', 'ch04/f001'], 2)).toBe('1.1, 2.1 +2 more');
  });
});

describe('runAll', () => {
  it('runs every item at most n at a time, reports progress, and keeps going past a refusal', async () => {
    let live = 0;
    let peak = 0;
    const progress: number[] = [];
    const task = async (n: number) => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      if (n === 2) throw new Error('refused');
      return n * 10;
    };

    const result = await runAll([1, 2, 3, 4, 5], task, { concurrency: 2, onSettled: (settled) => progress.push(settled) });

    expect(peak).toBe(2);
    expect(progress).toEqual([1, 2, 3, 4, 5]);
    expect(result.done.map((d) => d.value).sort((a, b) => a - b)).toEqual([10, 30, 40, 50]);
    expect(result.failed.map((f) => f.item)).toEqual([2]);
  });
});

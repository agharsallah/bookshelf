import { describe, expect, it } from 'vitest';
import type { JobCounts, PipelinePass, StageSpan } from '../../lib/api/types/stats';
import { ganttRows, MIN_BAR_PCT, quarterTicks, share, timeParts } from './model';

const counts = (total: number, failed = 0): JobCounts => ({ total, done: total - failed, failed, skipped: 0, queued: 0, running: 0 });

function stage(kind: StageSpan['kind'], start: number | null, end: number | null, jobs = 1, segments: [number, number][] = []): StageSpan {
  return {
    kind,
    jobs: counts(jobs),
    started_at: null,
    finished_at: null,
    start_offset_ms: start,
    end_offset_ms: end,
    span_ms: start !== null && end !== null ? end - start : null,
    busy_ms: 0,
    segments,
    compute_ms: 1000,
    duration: { count: 0, total_ms: 0, mean_ms: null, p50_ms: null, p95_ms: null, max_ms: null },
    tokens: 10,
  };
}

function pass(wall: number, stages: StageSpan[]): PipelinePass {
  return { index: 0, started_at: '', finished_at: '', wall_ms: wall, active_ms: wall, compute_ms: wall, jobs: 1, tokens: 1, includes_parse: true, stages };
}

describe('ganttRows', () => {
  it('places each stage on the pass clock as percentages', () => {
    const rows = ganttRows(pass(100_000, [stage('parse', 0, 10_000), stage('summarize', 25_000, 75_000, 4)]));

    expect(rows.map((r) => [r.label, r.left, r.width, r.jobs])).toEqual([
      ['Parse', 0, 10, 1],
      ['Summarize', 25, 50, 4],
    ]);
  });

  it('draws the busy stretches inside the span, not one solid bar', () => {
    const [parse] = ganttRows(pass(100_000, [stage('parse', 0, 70_000, 3, [[0, 1000], [69_000, 70_000]])]));

    expect(parse?.width).toBe(70);
    expect(parse?.busy.map((b) => b.left)).toEqual([0, 69]);
    expect(parse?.busy[1]?.width).toBeCloseTo(1);
  });

  it('keeps an instant stage visible and inside the track', () => {
    const [last] = ganttRows(pass(100_000, [stage('embed', 100_000, 100_000)]));

    expect(last?.width).toBeCloseTo(MIN_BAR_PCT);
    expect((last?.left ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(100);
  });

  it('leaves out stages that never ran', () => {
    expect(ganttRows(pass(1000, [stage('brief', null, null)]))).toEqual([]);
  });
});

describe('timeParts', () => {
  it('folds kinds into fixed groups in a fixed order', () => {
    const parts = timeParts({ distil_section: 300, describe_figure: 100, explain_table: 50, derive: 20, summarize: 70 });

    expect(parts.map((p) => [p.key, p.ms])).toEqual([
      ['elements', 150],
      ['summary', 70],
      ['sections', 300],
      ['study', 20],
    ]);
  });
});

describe('scales', () => {
  it('turns values into bounded shares and quarter ticks', () => {
    expect(share(50, 200)).toBe(25);
    expect(share(5, 0)).toBe(0);
    expect(quarterTicks(4000).map(([, ms]) => ms)).toEqual([0, 1000, 2000, 3000, 4000]);
  });
});

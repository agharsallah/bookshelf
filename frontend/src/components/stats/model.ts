/**
 * Chart geometry and grouping for the stats pages, kept out of the components so it is
 * testable without a DOM: the stage Gantt's bar positions, a chapter's time split into
 * a few fixed groups, and the labels insights wear.
 */
import type { JobKind } from '../../lib/api/types/jobs';
import type { InsightArea, PipelinePass, Severity } from '../../lib/api/types/stats';
import { KIND_LABELS } from '../pipeline/model';

/**
 * A chapter's compute time in five groups, each with a fixed series colour (identity
 * follows the group, never its rank), so every chapter's bar reads the same way.
 */
export const TIME_GROUPS = [
  { key: 'elements', label: 'Figures, tables, code', series: 'var(--series-5)', kinds: ['describe_figure', 'explain_code', 'describe_math', 'explain_table'] },
  { key: 'summary', label: 'Summary', series: 'var(--series-2)', kinds: ['summarize'] },
  { key: 'sections', label: 'Section notes', series: 'var(--series-1)', kinds: ['distil_section'] },
  { key: 'chapter', label: 'Chapter distillation', series: 'var(--series-3)', kinds: ['distil_chapter'] },
  { key: 'study', label: 'Study & other', series: 'var(--series-other)', kinds: [] },
] as const satisfies readonly { key: string; label: string; series: string; kinds: readonly JobKind[] }[];

export type TimeGroupKey = (typeof TIME_GROUPS)[number]['key'];

export interface TimePart {
  key: TimeGroupKey;
  label: string;
  series: string;
  ms: number;
}

function groupOf(kind: JobKind): TimeGroupKey {
  return TIME_GROUPS.find((g) => (g.kinds as readonly JobKind[]).includes(kind))?.key ?? 'study';
}

/** `ms_by_kind` folded into the fixed groups, in group order, empty groups left out. */
export function timeParts(msByKind: Partial<Record<JobKind, number>>): TimePart[] {
  const totals = new Map<TimeGroupKey, number>();
  for (const [kind, ms] of Object.entries(msByKind) as [JobKind, number][]) {
    totals.set(groupOf(kind), (totals.get(groupOf(kind)) ?? 0) + ms);
  }
  return TIME_GROUPS.flatMap((g) => {
    const ms = totals.get(g.key) ?? 0;
    return ms > 0 ? [{ key: g.key, label: g.label, series: g.series, ms }] : [];
  });
}

/** A drawn stretch of a Gantt row, as percentages of the pass's wall clock. */
export interface Stretch {
  left: number;
  width: number;
}

export interface GanttRow {
  kind: JobKind;
  label: string;
  /** From the stage's first start to its last finish. */
  left: number;
  width: number;
  /** When it was actually running, inside that span. */
  busy: Stretch[];
  spanMs: number;
  busyMs: number;
  computeMs: number;
  jobs: number;
  failed: number;
  tokens: number;
}

/** The smallest drawn width, so a stage that took a second is still visible. */
export const MIN_BAR_PCT = 0.6;

/** `[start, end]` ms on a clock of `total` ms, as a visible stretch inside the track. */
export function stretch(start: number, end: number, total: number): Stretch {
  const left = Math.min((start / total) * 100, 100 - MIN_BAR_PCT);
  const width = Math.max(((end - start) / total) * 100, MIN_BAR_PCT);
  return { left, width: Math.min(width, 100 - left) };
}

/** One row per stage that ran in the pass, positioned on the pass's own clock. */
export function ganttRows(pass: PipelinePass): GanttRow[] {
  const total = Math.max(pass.wall_ms, 1);
  return pass.stages.flatMap((stage) => {
    if (stage.start_offset_ms === null || stage.end_offset_ms === null) return [];
    const span = stretch(stage.start_offset_ms, stage.end_offset_ms, total);
    const segments = stage.segments.length ? stage.segments : [[stage.start_offset_ms, stage.end_offset_ms] as [number, number]];
    return [
      {
        kind: stage.kind,
        label: KIND_LABELS[stage.kind],
        ...span,
        busy: segments.map(([start, end]) => stretch(start, end, total)),
        spanMs: stage.span_ms ?? 0,
        busyMs: stage.busy_ms,
        computeMs: stage.compute_ms,
        jobs: stage.jobs.total,
        failed: stage.jobs.failed,
        tokens: stage.tokens,
      },
    ];
  });
}

/** Axis ticks at quarters of the pass: [position %, offset ms]. */
export function quarterTicks(wallMs: number): [number, number][] {
  return [0, 25, 50, 75, 100].map((pct) => [pct, (wallMs * pct) / 100]);
}

/** A share of the largest value, for inline bars on one scale per column. */
export function share(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

export const SEVERITY_LABELS: Record<Severity, string> = { high: 'Fix first', medium: 'Worth a look', info: 'Note' };

/** A glyph per severity, so severity is never carried by colour alone. */
export const SEVERITY_ICONS: Record<Severity, string> = { high: '▲', medium: '●', info: '○' };

export const AREA_LABELS: Record<InsightArea, string> = {
  cost: 'Cost',
  speed: 'Speed',
  reliability: 'Reliability',
  quality: 'Quality',
  throughput: 'Throughput',
  telemetry: 'Telemetry',
};

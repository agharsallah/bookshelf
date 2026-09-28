/**
 * `GET /papers/compare` → what the compare page draws: a results matrix (method rows ×
 * dataset/metric columns, grouped by dataset) and one bar chart per column.
 *
 * - Each paper keeps one categorical slot, in the order it was picked, so its colour is
 *   the same in every chart (a seventh paper and on fold into "other").
 * - A matrix cell holds every value reported for that method and column (several papers
 *   or settings may report one); `best` and `comparable` come from the backend.
 * - A chart shows only comparable, finite, non-negative values (bars need a zero
 *   baseline), best first in the column's direction, and counts what it left out.
 */
import { anchorLabel } from '../../../lib/anchors';
import type { ResultCell, ResultColumn, ResultsComparison } from '../../../lib/api/types/paperShelf';
import type { BarRow } from '../../charts/HBars';
import { OTHER, SLOTS, type Series } from '../../charts/chart';

export interface PaperKey {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  color: string;
  hasResults: boolean;
  rows: number;
}

export interface CiteLink {
  href: string | null;
  label: string;
  title: string;
}

export interface CellView {
  text: string;
  unit: string | null;
  setting: string | null;
  best: boolean;
  comparable: boolean;
  proposed: boolean;
  paper: PaperKey | null;
  cites: CiteLink[];
}

export interface ColumnView {
  key: string;
  dataset: string;
  metric: string;
  unit: string | null;
  higherIsBetter: boolean;
  best: number | null;
}

export interface DatasetGroup {
  dataset: string;
  span: number;
}

export interface RowView {
  key: string;
  method: string;
  /** Some paper reports this method as its own. */
  proposed: boolean;
  /** One list per column, aligned with `columns`. */
  cells: CellView[][];
}

export interface MatrixView {
  papers: PaperKey[];
  columns: ColumnView[];
  groups: DatasetGroup[];
  rows: RowView[];
}

const numbers = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

export function formatValue(value: number): string {
  return Number.isFinite(value) ? numbers.format(value) : String(value);
}

export function paperKeys(comparison: ResultsComparison): PaperKey[] {
  return comparison.papers.map((p, i) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    year: p.year,
    color: SLOTS[i] ?? OTHER,
    hasResults: p.results_artifact_id !== null,
    rows: p.rows,
  }));
}

/** `<document_id>#<anchor>` → the reader of that paper, when it is one of the compared. */
export function citeLink(cite: string, papers: ReadonlyMap<string, PaperKey>): CiteLink {
  const at = cite.indexOf('#');
  const [doc, anchor] = at === -1 ? ['', cite] : [cite.slice(0, at), cite.slice(at + 1)];
  const paper = papers.get(doc);
  return {
    href: paper ? `/documents/${encodeURIComponent(paper.slug)}/read/${anchor}` : null,
    label: anchorLabel(anchor),
    title: paper ? `${paper.title}, ${anchor}` : anchor,
  };
}

function cellView(cell: ResultCell, papers: ReadonlyMap<string, PaperKey>): CellView {
  return {
    text: formatValue(cell.value),
    unit: cell.unit,
    setting: cell.setting,
    best: cell.best,
    comparable: cell.comparable,
    proposed: cell.is_proposed,
    paper: papers.get(cell.paper_id) ?? null,
    cites: cell.cites.map((c) => citeLink(c, papers)),
  };
}

/** Columns grouped by dataset (first-seen order), metrics in their order within one. */
function orderColumns(columns: readonly ResultColumn[]): ResultColumn[] {
  const datasets = [...new Set(columns.map((c) => c.dataset))];
  return datasets.flatMap((d) => columns.filter((c) => c.dataset === d));
}

export function buildMatrix(comparison: ResultsComparison): MatrixView {
  const papers = paperKeys(comparison);
  const byId = new Map(papers.map((p) => [p.id, p]));
  const ordered = orderColumns(comparison.columns);
  const columns: ColumnView[] = ordered.map((c) => ({
    key: c.key,
    dataset: c.dataset,
    metric: c.metric,
    unit: c.unit,
    higherIsBetter: c.higher_is_better,
    best: c.best,
  }));
  const groups: DatasetGroup[] = [];
  for (const c of columns) {
    const last = groups.at(-1);
    if (last?.dataset === c.dataset) last.span += 1;
    else groups.push({ dataset: c.dataset, span: 1 });
  }
  const rows: RowView[] = comparison.rows.map((r) => ({
    key: r.key,
    method: r.method,
    proposed: r.cells.some((c) => c.is_proposed),
    cells: columns.map((col) => r.cells.filter((c) => c.column === col.key).map((c) => cellView(c, byId))),
  }));
  return { papers, columns, groups, rows };
}

export interface MetricChart {
  key: string;
  title: string;
  unit: string | null;
  higherIsBetter: boolean;
  rows: BarRow[];
  series: Series[];
  /** Values not drawn: another unit, or below zero. */
  leftOut: number;
}

/** One bar chart per column with at least one drawable value. */
export function metricCharts(comparison: ResultsComparison): MetricChart[] {
  const papers = paperKeys(comparison);
  const byId = new Map(papers.map((p) => [p.id, p]));
  return orderColumns(comparison.columns).flatMap((col) => {
    const cells = comparison.rows.flatMap((r) => r.cells.filter((c) => c.column === col.key).map((c) => ({ method: r.method, cell: c })));
    const drawable = cells.filter(({ cell }) => cell.comparable && Number.isFinite(cell.value) && cell.value >= 0);
    if (drawable.length === 0) return [];
    const sorted = [...drawable].sort((a, b) => (col.higher_is_better ? b.cell.value - a.cell.value : a.cell.value - b.cell.value));
    const rows: BarRow[] = sorted.map(({ method, cell }, i) => {
      const paper = byId.get(cell.paper_id);
      const label = cell.setting ? `${method} (${cell.setting})` : method;
      const sub = [paper?.title, cell.is_proposed ? 'proposed' : null, cell.best ? 'best' : null].filter(Boolean).join(', ');
      return {
        key: `${cell.paper_id}-${method}-${cell.setting ?? ''}-${i}`,
        label,
        ...(sub ? { sub } : {}),
        values: { [cell.paper_id]: cell.value },
        valueLabel: `${formatValue(cell.value)}${cell.unit ? ` ${cell.unit}` : ''}`,
      };
    });
    const present = new Set(drawable.map(({ cell }) => cell.paper_id));
    const series: Series[] = papers.filter((p) => present.has(p.id)).map((p) => ({ key: p.id, label: p.title, color: p.color }));
    return [
      {
        key: col.key,
        title: `${col.metric} on ${col.dataset}`,
        unit: col.unit,
        higherIsBetter: col.higher_is_better,
        rows,
        series,
        leftOut: cells.length - drawable.length,
      },
    ];
  });
}

/** `?ids=a,b&ids=c` → unique ids in order, at most 20 (the API's cap). */
export function parseIds(params: URLSearchParams): string[] {
  const ids = params
    .getAll('ids')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  return [...new Set(ids)].slice(0, 20);
}

export function compareHref(ids: readonly string[]): string {
  return ids.length ? `/papers/compare?ids=${ids.map(encodeURIComponent).join(',')}` : '/papers/compare';
}

/** A title's short form: before a colon, else its first five words. */
function shortTitle(title: string): string {
  const head = title.split(':')[0]?.trim() || title;
  const words = head.split(/\s+/);
  return words.length > 5 ? `${words.slice(0, 5).join(' ')}…` : head;
}

/** A default set name from the papers' short titles. */
export function setName(titles: readonly string[]): string {
  const short = titles.map(shortTitle);
  const name = short.length > 2 ? `${short.slice(0, 2).join(', ')} and ${short.length - 2} more` : short.join(' and ');
  return name.slice(0, 200);
}

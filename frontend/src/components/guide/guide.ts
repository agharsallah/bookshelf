/**
 * The book guide (skills/write-guide/schema.json): four block sections in a fixed order,
 * plus the structured lists the guide page draws as visuals — the chapter journey, the
 * recurring themes and the key numbers. Parsing is defensive so a malformed body renders
 * what it can instead of failing the page.
 *
 * Also the page's pure view-model: chapter rows (reading time + role), the theme ×
 * chapter heatmap (computed from where each theme's spans cite), and at-a-glance stats.
 */
import type { RenderBlock, Span } from '../../lib/contract';
import type { TreeNode } from '../../lib/api/types/documents';
import { isUnder } from '../../lib/documents/tree';
import { WORDS_PER_MINUTE, wordCount } from '../reader/progress';

export const GUIDE_KEYS = ['overview', 'map', 'deep_dive', 'practice'] as const;
export type GuideKey = (typeof GUIDE_KEYS)[number];

export const DEFAULT_TITLES: Record<GuideKey, string> = {
  overview: 'The book in brief',
  map: 'The big picture',
  deep_dive: 'The core ideas in depth',
  practice: 'Putting the book to work',
};

/** Chapter roles in the order they take the chart series colours (never cycled). */
export const ROLES = ['setup', 'concept', 'method', 'evidence', 'application', 'synthesis'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  setup: 'Sets up',
  concept: 'Core idea',
  method: 'Method',
  evidence: 'Evidence',
  application: 'Application',
  synthesis: 'Synthesis',
};

/** The series colour of a role; chapters without one wear the neutral "other". */
export function roleColor(role: Role | null): string {
  return role ? `var(--series-${ROLES.indexOf(role) + 1})` : 'var(--series-other)';
}

export interface GuideSection {
  key: GuideKey;
  title: string;
  blocks: RenderBlock[];
}

export interface JourneyEntry {
  anchor: string;
  role: Role | null;
  takeaway: Span[];
}

export interface Theme {
  name: string;
  spans: Span[];
}

export interface KeyNumber {
  value: string;
  label: Span[];
}

export interface Guide {
  sections: GuideSection[];
  journey: JourneyEntry[];
  themes: Theme[];
  numbers: KeyNumber[];
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const isKey = (v: unknown): v is GuideKey => typeof v === 'string' && (GUIDE_KEYS as readonly string[]).includes(v);
const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);
const isSpan = (v: unknown): v is Span => isRecord(v) && typeof v.text === 'string' && Array.isArray(v.cites);
const records = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const spans = (v: unknown): Span[] => (Array.isArray(v) ? v.filter(isSpan) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The guide in its canonical order; null when the body has no recognisable sections. */
export function parseGuide(body: Json): Guide | null {
  const byKey = new Map<GuideKey, GuideSection>();
  for (const section of records(body.sections)) {
    if (!isKey(section.key) || byKey.has(section.key)) continue;
    byKey.set(section.key, {
      key: section.key,
      title: text(section.title) || DEFAULT_TITLES[section.key],
      blocks: records(section.blocks) as unknown as RenderBlock[],
    });
  }
  if (byKey.size === 0) return null;
  return {
    sections: GUIDE_KEYS.map((key) => byKey.get(key)).filter((s): s is GuideSection => s !== undefined),
    journey: records(body.journey)
      .filter((j) => text(j.anchor))
      .map((j) => ({ anchor: text(j.anchor), role: isRole(j.role) ? j.role : null, takeaway: spans(j.takeaway) })),
    themes: records(body.themes)
      .filter((t) => text(t.name))
      .map((t) => ({ name: text(t.name), spans: spans(t.spans) })),
    numbers: records(body.numbers)
      .filter((n) => text(n.value))
      .map((n) => ({ value: text(n.value), label: spans(n.label) })),
  };
}

// --- The page's view-model -------------------------------------------------------------

/** What the charts need of a chapter: its address, title and reading length. */
export interface Unit {
  anchor: string;
  heading: string;
  words: number;
  frontMatter: boolean;
}

/** Words under a node, from a tree fetched with its blocks. */
export function wordsUnder(node: TreeNode): number {
  return node.children.reduce((sum, child) => sum + wordsUnder(child), wordCount(node.text ?? ''));
}

export function unitOf(node: TreeNode): Unit {
  return {
    anchor: node.anchor,
    heading: node.heading ?? node.anchor,
    words: wordsUnder(node),
    frontMatter: Boolean(node.meta.front_matter),
  };
}

export interface ChapterRow {
  anchor: string;
  heading: string;
  /** 1-based position among the rows, for compact column labels. */
  number: number;
  minutes: number;
  /** Reading time relative to the longest chapter, 0–1: the bar's length. */
  share: number;
  /** Share of the whole book's words, 0–1: the arc strip's segment width. */
  weight: number;
  role: Role | null;
  takeaway: Span[];
}

export function minutesFor(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0;
}

/**
 * One row per chapter the guide describes, plus every other chapter that is not front
 * matter (so a chapter the model skipped still shows, without a role), in reading order.
 * A journey entry naming no chapter on the shelf is dropped: it cannot be placed.
 */
export function chapterRows(units: readonly Unit[], journey: readonly JourneyEntry[]): ChapterRow[] {
  const entries = new Map(journey.map((j) => [j.anchor, j]));
  const shown = units.filter((u) => entries.has(u.anchor) || (!u.frontMatter && u.words > 0));
  const minutes = shown.map((u) => minutesFor(u.words));
  const longest = Math.max(1, ...minutes);
  const total = shown.reduce((sum, u) => sum + u.words, 0) || 1;
  return shown.map((unit, i) => {
    const entry = entries.get(unit.anchor);
    return {
      anchor: unit.anchor,
      heading: unit.heading,
      number: i + 1,
      minutes: minutes[i] ?? 0,
      share: (minutes[i] ?? 0) / longest,
      weight: unit.words / total,
      role: entry?.role ?? null,
      takeaway: entry?.takeaway ?? [],
    };
  });
}

/** How many chapters play each role, in role order, roles that occur only. */
export function roleCounts(rows: readonly ChapterRow[]): { role: Role; count: number }[] {
  return ROLES.map((role) => ({ role, count: rows.filter((r) => r.role === role).length })).filter((r) => r.count > 0);
}

export interface HeatCell {
  /** Distinct passages this theme cites inside the chapter. */
  count: number;
  /** Heat step 0–4 (0 = absent), relative to the densest cell. */
  level: number;
  /** The first passage cited there: where the cell links. */
  first: string | null;
}

export interface HeatRow {
  name: string;
  cells: HeatCell[];
  /** Chapters the theme appears in. */
  reach: number;
}

export const HEAT_LEVELS = 4;

/** Theme × chapter: where the author returns to each theme, from its spans' citations. */
export function themeMatrix(themes: readonly Theme[], rows: readonly ChapterRow[]): HeatRow[] {
  const counted = themes.map((theme) => {
    const cites = [...new Set(theme.spans.flatMap((s) => s.cites))];
    return {
      name: theme.name,
      hits: rows.map((row) => cites.filter((c) => isUnder(c, row.anchor))),
    };
  });
  const densest = Math.max(1, ...counted.flatMap((t) => t.hits.map((h) => h.length)));
  return counted.map(({ name, hits }) => ({
    name,
    cells: hits.map((h) => ({
      count: h.length,
      level: h.length === 0 ? 0 : Math.max(1, Math.ceil((h.length / densest) * HEAT_LEVELS)),
      first: h[0] ?? null,
    })),
    reach: hits.filter((h) => h.length > 0).length,
  }));
}

/** "45 min", "3 h", "6 h 20 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export interface Glance {
  label: string;
  value: string;
}

/** The at-a-glance row: the book's size and how much the guide maps. */
export function glance(guide: Guide, rows: readonly ChapterRow[], pages: number | null): Glance[] {
  const all = guide.sections.flatMap((s) => s.blocks);
  const deep = guide.sections.find((s) => s.key === 'deep_dive')?.blocks ?? [];
  const ideas = deep.filter((b) => b.type === 'heading' && b.level === 2).length;
  const diagrams = all.filter((b) => b.type === 'diagram' || b.type === 'chart').length;
  const minutes = rows.reduce((sum, r) => sum + r.minutes, 0);
  const items: (Glance | null)[] = [
    { label: rows.length === 1 ? 'chapter' : 'chapters', value: String(rows.length) },
    minutes > 0 ? { label: 'to read in full', value: durationLabel(minutes) } : null,
    pages ? { label: 'pages', value: String(pages) } : null,
    ideas > 0 ? { label: ideas === 1 ? 'core idea' : 'core ideas', value: String(ideas) } : null,
    diagrams > 0 ? { label: diagrams === 1 ? 'diagram or chart' : 'diagrams and charts', value: String(diagrams) } : null,
  ];
  return items.filter((g): g is Glance => g !== null);
}

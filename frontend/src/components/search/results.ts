/**
 * Shaping `POST /search` responses for display: each document's hits split into
 * "what you know" (distillations) and "evidence" (source blocks), lexical highlight
 * ranges turned into marked segments, and one flat, display-ordered list of hits for
 * keyboard navigation.
 */
import type { SearchDocument, SearchGroup, SearchHit, SearchResponse } from '../../lib/api/types/search';
import { toUtf16Offset } from '../../lib/codepoints';
import { readerHref } from './links';

export interface HitView {
  /** Stable within one response; also the DOM id suffix. */
  key: string;
  hit: SearchHit;
  href: string;
}

export interface GroupView {
  document: SearchDocument;
  known: HitView[];
  evidence: HitView[];
}

export interface ResultsView {
  /** Addressed queries: the chapter (or document) the query resolved to. */
  resolved: { document: SearchDocument; anchor: string | null; href: string; heading: string | null } | null;
  groups: GroupView[];
  /** Every hit in the order it is shown. */
  order: HitView[];
  total: number;
}

export function hitHref(document: SearchDocument, hit: SearchHit): string {
  return readerHref(document.slug, hit.anchor);
}

function viewsOf(group: SearchGroup, groupIndex: number): GroupView {
  const known: HitView[] = [];
  const evidence: HitView[] = [];
  group.hits.forEach((hit, i) => {
    const view = { key: `${groupIndex}-${i}`, hit, href: hitHref(group.document, hit) };
    (hit.kind === 'distillation' ? known : evidence).push(view);
  });
  return { document: group.document, known, evidence };
}

export function buildResults(response: SearchResponse): ResultsView {
  const groups = response.groups.map(viewsOf);
  const order = groups.flatMap((g) => [...g.known, ...g.evidence]);
  let resolved: ResultsView['resolved'] = null;
  if (response.intent === 'addressed' && response.resolved) {
    const { document, anchor } = response.resolved;
    const heading = response.groups[0]?.hits.find((h) => h.heading)?.heading ?? null;
    resolved = { document, anchor, href: readerHref(document.slug, anchor), heading };
  }
  return { resolved, groups, order, total: order.length };
}

export interface Segment {
  text: string;
  marked: boolean;
}

/**
 * Split a snippet into plain and highlighted runs. Ranges arrive as code points (see
 * lib/codepoints) and are converted, clamped, sorted and merged.
 */
export function highlightSegments(snippet: string, ranges: readonly (readonly [number, number])[] | null | undefined): Segment[] {
  const clamp = (at: number) => Math.max(0, Math.min(toUtf16Offset(snippet, at), snippet.length));
  const clean = (ranges ?? [])
    .map(([s, e]) => [clamp(s), clamp(e)] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of clean) {
    const last = merged.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  const out: Segment[] = [];
  let at = 0;
  for (const [s, e] of merged) {
    if (s > at) out.push({ text: snippet.slice(at, s), marked: false });
    out.push({ text: snippet.slice(s, e), marked: true });
    at = e;
  }
  if (at < snippet.length || out.length === 0) out.push({ text: snippet.slice(at), marked: false });
  return out;
}

/** The next index when moving through `count` hits; -1 means "back in the query box". */
export function stepHit(current: number, delta: 1 | -1, count: number): number {
  if (count === 0) return -1;
  return Math.max(-1, Math.min(count - 1, current + delta));
}

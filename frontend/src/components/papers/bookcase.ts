/**
 * The paper shelf's overview, drawn as a bookcase: one plank per year, one spine per
 * paper. A spine's height follows how often the paper is cited (log scale), its colour
 * your verdict, its bands the passes you have done. These helpers shape the data; the
 * drawing is Bookcase.astro.
 */
import type { PaperSummary, PaperVerdict } from '../../lib/api/types/papers';
import { PAPER_VERDICTS } from '../../lib/api/types/papers';

/** Spine heights, in rem: an uncited paper stands at the floor, ~100k citations at the ceiling. */
export const SPINE_FLOOR = 7;
export const SPINE_CEILING = 12;
const CITATIONS_AT_CEILING = 100_000;

/** A spine's height in rem: log-scaled citations, the floor when unknown. */
export function spineHeight(citedBy: number | null): number {
  if (citedBy === null || citedBy <= 0) return SPINE_FLOOR;
  const share = Math.min(1, Math.log10(citedBy + 1) / Math.log10(CITATIONS_AT_CEILING + 1));
  return Math.round((SPINE_FLOOR + share * (SPINE_CEILING - SPINE_FLOOR)) * 100) / 100;
}

/** What fits on a spine: the name before a colon ("LEGO-RL"), else the whole title. */
export function spineTitle(title: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  const colon = clean.indexOf(':');
  return colon >= 2 && colon <= 40 ? clean.slice(0, colon) : clean;
}

export interface Plank {
  /** null: the papers whose year is not known, on the bottom plank. */
  year: number | null;
  papers: PaperSummary[];
}

/** Papers on one plank per year, newest on top; within a plank they keep the given order. */
export function planksByYear(papers: readonly PaperSummary[]): Plank[] {
  const byYear = new Map<number | null, PaperSummary[]>();
  for (const paper of papers) byYear.set(paper.year, [...(byYear.get(paper.year) ?? []), paper]);
  return [...byYear]
    .map(([year, found]) => ({ year, papers: found }))
    .sort((a, b) => (a.year === null ? 1 : b.year === null ? -1 : b.year - a.year));
}

export interface ShelfTally {
  total: number;
  /** At least the first pass done. */
  started: number;
  rated: number;
  /** With a tl;dr from a paper card. */
  carded: number;
  verdicts: Record<PaperVerdict, number>;
}

export function shelfTally(papers: readonly PaperSummary[], carded: ReadonlySet<string>): ShelfTally {
  const verdicts = Object.fromEntries(PAPER_VERDICTS.map((v) => [v, 0])) as Record<PaperVerdict, number>;
  let started = 0;
  let rated = 0;
  for (const paper of papers) {
    if ((paper.highest_pass ?? 0) > 0) started += 1;
    if (paper.rating) rated += 1;
    if (paper.rating?.verdict) verdicts[paper.rating.verdict] += 1;
  }
  return { total: papers.length, started, rated, carded: papers.filter((p) => carded.has(p.id)).length, verdicts };
}

/** "47 papers. 3 started, 1 rated, 40 with a card." */
export function tallyLine(tally: ShelfTally): string {
  const papers = `${tally.total} ${tally.total === 1 ? 'paper' : 'papers'}`;
  if (tally.total === 0) return `${papers}.`;
  const started = tally.started === 0 ? 'none started' : `${tally.started} started`;
  const rated = tally.rated === 0 ? 'none rated' : `${tally.rated} rated`;
  return `${papers}: ${started}, ${rated}, ${tally.carded} with a card.`;
}

/** "Cited 532 times", "Cited once", or "" when not known. */
export function citedLine(citedBy: number | null): string {
  if (citedBy === null) return '';
  if (citedBy === 0) return 'Not cited yet';
  if (citedBy === 1) return 'Cited once';
  return `Cited ${citedBy.toLocaleString('en')} times`;
}

/** The papers with a paper card (approved or waiting for review, not rejected). */
export function cardedIds(papers: readonly PaperSummary[]): Set<string> {
  return new Set(papers.filter((p) => p.artifacts.some((a) => a.type === 'paper_card' && a.review !== 'rejected')).map((p) => p.id));
}

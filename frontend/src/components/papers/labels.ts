/**
 * Plain words for the paper vocabularies (verdicts, passes, citation intents, explainer
 * levels) and the small formatting every paper surface shares.
 */
import type { CitationIntent, ExplainerLevel, PaperVerdict, PassNumber } from '../../lib/api/types/papers';

export const VERDICT_LABELS: Record<PaperVerdict, string> = {
  must_read: 'Must read',
  useful: 'Useful',
  skim: 'Skim',
  skip: 'Skip',
};

/** Keshav's three passes (docs/PAPERS.md §6): what each asks of you. */
export const PASS_LABELS: Record<PassNumber, { name: string; hint: string }> = {
  1: { name: 'Skim', hint: 'Title, abstract, headings, conclusion and figures: what kind of paper is it?' },
  2: { name: 'Read', hint: 'The body without proofs or appendix: what does it claim, and on what evidence?' },
  // A non-breaking hyphen: the name never splits across lines.
  3: { name: 'Re\u2011create', hint: 'Everything, as if you had to redo the work: where are its weak spots?' },
};

export const INTENT_LABELS: Record<CitationIntent, string> = {
  background: 'Background',
  uses: 'Uses',
  extends: 'Extends',
  compares: 'Compares with',
  contradicts: 'Contradicts',
};

export const LEVEL_LABELS: Record<ExplainerLevel, { name: string; hint: string }> = {
  newcomer: { name: 'Newcomer', hint: 'New to the field: every term explained, no equations assumed.' },
  practitioner: { name: 'Practitioner', hint: 'You work in the area: the method and results in its own terms.' },
  expert: { name: 'Expert', hint: 'You know the literature: what is new, and how it differs.' },
};

/** "Vaswani, Shazeer and Parmar", or "Vaswani, Shazeer et al." past `max` authors. */
export function authorLine(authors: readonly string[], max = 3): string {
  if (authors.length === 0) return '';
  if (authors.length > max) return `${authors.slice(0, max - 1).join(', ')} et al.`;
  if (authors.length === 1) return authors[0] ?? '';
  return `${authors.slice(0, -1).join(', ')} and ${authors.at(-1) ?? ''}`;
}

/** "NeurIPS, 2017", "2017", "NeurIPS", or "" when neither is known. */
export function venueLine(venue: string | null, year: number | null): string {
  return [venue, year].filter((part) => part !== null && part !== '').join(', ');
}

/** "4 of 5 stars", for screen readers and titles. */
export function starsLabel(stars: number): string {
  return `${stars} of 5 stars`;
}

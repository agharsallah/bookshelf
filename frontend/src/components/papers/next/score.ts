/**
 * The score of a reading candidate, term by term (`score_parts`, backend
 * `app/papers/scoring.py`). The score is the plain sum of its parts, so the breakdown is a
 * bar list on one shared scale: each term's bar is its share of the page's largest term,
 * and a term that lowers the score (a source paper you rated below 3 stars) points left.
 */

export interface TermInfo {
  key: string;
  name: string;
  /** What the term measures, in plain words. */
  explain: string;
}

/** In the backend's `PARTS` order. */
export const SCORE_TERMS: readonly TermInfo[] = [
  { key: 'source', name: 'How it was found', explain: 'Found through a bibliography counts most, then papers citing yours, the watch list, similar and related works.' },
  { key: 'rating', name: 'Your ratings', explain: 'How you rated the shelf papers that lead to it: above 3 stars raises it, below lowers it.' },
  { key: 'shelf', name: 'Cited on your shelf', explain: 'How many papers on your shelf cite it.' },
  { key: 'intent', name: 'How they cite it', explain: 'Papers that extend or use it count more than a passing background mention.' },
  { key: 'citations', name: 'Citations', explain: 'How often the field cites it (on a log scale).' },
  { key: 'recency', name: 'Recency', explain: 'Newer papers count a little more; the weight halves every five years.' },
  { key: 'similarity', name: 'Like papers you rated highly', explain: 'How close its abstract is to papers you gave 4 or 5 stars.' },
];

const BY_KEY = new Map(SCORE_TERMS.map((t) => [t.key, t]));

export interface ScoreTerm extends TermInfo {
  value: number;
  /** |value| / scale, 0–1: the bar's length. */
  length: number;
  lowers: boolean;
}

/** Below this a part is noise from rounding: left out of the list. */
const EPSILON = 1e-4;

/** The largest |part| over some candidates: the shared scale of their breakdowns. */
export function scoreScale(parts: readonly Record<string, number>[]): number {
  return Math.max(0, ...parts.flatMap((p) => Object.values(p).map((v) => (Number.isFinite(v) ? Math.abs(v) : 0))));
}

/**
 * The terms that moved this score, known ones in the backend's order then any new ones,
 * each with its bar length on `scale` (the candidate's own largest term by default).
 */
export function scoreTerms(parts: Record<string, number>, scale = scoreScale([parts])): ScoreTerm[] {
  const keys = [...SCORE_TERMS.map((t) => t.key), ...Object.keys(parts).filter((k) => !BY_KEY.has(k)).sort()];
  return keys.flatMap((key) => {
    const value = parts[key];
    if (value === undefined || !Number.isFinite(value) || Math.abs(value) < EPSILON) return [];
    const info = BY_KEY.get(key) ?? { key, name: key.replace(/_/g, ' '), explain: '' };
    return [{ ...info, value, length: scale > 0 ? Math.min(1, Math.abs(value) / scale) : 0, lowers: value < 0 }];
  });
}

/** The one or two terms that raised it most, for the card's one-line summary. */
export function leadingTerms(terms: readonly ScoreTerm[], n = 2): ScoreTerm[] {
  return [...terms]
    .filter((t) => !t.lowers)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

/** `+0.84`, `−0.75` (a true minus sign). */
export function signed(value: number): string {
  const text = Math.abs(value).toFixed(2);
  return value < 0 ? `−${text}` : `+${text}`;
}

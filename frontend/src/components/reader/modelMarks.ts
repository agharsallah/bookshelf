/**
 * Marks chosen by the `mark-salience` skill, placed on the source text. The skill copies
 * each passage verbatim and cites its block; here each copy is found in that block's
 * text and becomes a `Salient` range. Matching forgives what the backend's verbatim gate
 * forgives (runs of whitespace, curly vs straight quotes, en and em dashes); a passage
 * still not found is dropped rather than guessed at.
 */
import type { TreeNode } from '../../lib/api/types/documents';
import { SALIENCE_TIERS, TIER_LABELS, type Salient, type SalienceTier } from './salience';

/** Typography a model tends to straighten when it copies; one character each way. */
const SAME: Readonly<Record<string, string>> = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-' };

/** `text` with whitespace runs collapsed and typography straightened, and where each character came from. */
function normalised(text: string): { norm: string; from: number[] } {
  let norm = '';
  const from: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? '';
    if (/\s/.test(ch)) {
      space = norm.length > 0;
      continue;
    }
    if (space) {
      norm += ' ';
      from.push(i);
      space = false;
    }
    norm += SAME[ch] ?? ch;
    from.push(i);
  }
  return { norm, from };
}

/** Where `quote` sits in `text` (UTF-16 offsets), or null when it is not there. */
export function locate(text: string, quote: string): { start: number; end: number } | null {
  const exact = text.indexOf(quote);
  if (exact >= 0 && quote) return { start: exact, end: exact + quote.length };
  const needle = normalised(quote).norm;
  if (!needle) return null;
  const { norm, from } = normalised(text);
  const at = norm.indexOf(needle);
  if (at < 0) return null;
  const first = from[at];
  const last = from[at + needle.length - 1];
  return first === undefined || last === undefined ? null : { start: first, end: last + 1 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTier(value: unknown): value is SalienceTier {
  return typeof value === 'string' && (SALIENCE_TIERS as readonly string[]).includes(value);
}

/** A `salience_marks` body as marks on `nodes`, in reading order; null when there is no body. */
export function marksFromBody(body: Record<string, unknown> | null | undefined, nodes: readonly TreeNode[]): Salient[] | null {
  if (!body) return null;
  const texts = new Map(nodes.map((n) => [n.anchor, n.text ?? '']));
  const order = new Map(nodes.map((n, i) => [n.anchor, i]));
  const out: Salient[] = [];
  for (const mark of Array.isArray(body.marks) ? body.marks.filter(isRecord) : []) {
    const anchor = Array.isArray(mark.cites) ? mark.cites.find((c): c is string => typeof c === 'string') : undefined;
    if (!anchor || !isTier(mark.tier) || typeof mark.text !== 'string') continue;
    const range = locate(texts.get(anchor) ?? '', mark.text);
    if (!range) continue;
    const why = typeof mark.why === 'string' ? mark.why : '';
    const term = mark.tier === 'term';
    out.push({
      id: `${anchor}@${range.start}`,
      anchor,
      ...range,
      tier: mark.tier,
      title: term ? mark.text.charAt(0).toUpperCase() + mark.text.slice(1) : TIER_LABELS[mark.tier],
      why: term ? 'Term · defined here' : why,
      gloss: term ? why || null : null,
      source: 'model',
    });
  }
  return out.sort((a, b) => (order.get(a.anchor) ?? 0) - (order.get(b.anchor) ?? 0) || a.start - b.start);
}

/**
 * The model's marks in place of the inferred sentences; inferred terms fill in the ones it
 * left out (a term it did not mark, where it does not overlap a mark of its own).
 */
export function mergeMarks(model: readonly Salient[], inferred: readonly Salient[]): Salient[] {
  const named = new Set(model.filter((s) => s.tier === 'term').map((s) => s.title.toLowerCase()));
  const overlaps = (s: Salient) => model.some((m) => m.anchor === s.anchor && m.tier === 'term' && m.start < s.end && s.start < m.end);
  const extra = inferred.filter((s) => s.tier === 'term' && !named.has(s.title.toLowerCase()) && !overlaps(s));
  return [...model, ...extra];
}

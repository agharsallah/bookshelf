/**
 * "What matters" marks over a chapter's source text: the sentences carrying its
 * core ideas and key points, and the first mention of each term the book defines.
 *
 * Today the marks are inferred from what the shelf already knows: a passage matters
 * as much as the distillation, section notes and summary lean on it (their cites),
 * and a term is anything the idea graph or the glossary names. A `mark-salience`
 * skill can later supply the same `Salient` shape with `source: 'model'`.
 *
 * Offsets are UTF-16 indices into the node's `text`, like the reader's note marks.
 */
import type { TreeNode } from '../../lib/api/types/documents';
import { blockCites, collectCites, walkSpans, type RenderBlock } from '../../lib/contract';
import type { LexTerm } from './lexicon';
import type { Panes } from './panes';
import { pieces } from './segments';

/** Strongest first. Core ideas and key points are sentences; terms are phrases. */
export const SALIENCE_TIERS = ['core', 'key', 'term'] as const;
export type SalienceTier = (typeof SALIENCE_TIERS)[number];

export const TIER_LABELS: Record<SalienceTier, string> = {
  core: 'Core idea',
  key: 'Key point',
  term: 'Term',
};

export interface Salient {
  /** Stable across visits while the text is unchanged: `<anchor>@<start>`. */
  id: string;
  anchor: string;
  start: number;
  end: number;
  tier: SalienceTier;
  /** The card's heading: the tier's name, or the term itself. */
  title: string;
  /** Why it was marked, one line. */
  why: string;
  /** A definition or blurb (terms). */
  gloss: string | null;
  source: 'heuristic' | 'model';
}

/** How much the chapter's notes lean on each passage. */
export interface CiteWeights {
  /** Spans (and block-level cites) in the distillation and section notes citing the anchor. */
  notes: ReadonlyMap<string, number>;
  /** Anchors the chapter summary cites: the most compressed view still needed them. */
  summary: ReadonlySet<string>;
}

const TEXT_KINDS = new Set(['paragraph', 'list', 'quote', 'aside']);
/** Share of the chapter's text blocks that get a sentence marked; the rest stays quiet. */
const SENTENCE_SHARE = 0.2;
/** Of the marked sentences, the best-scored share are core ideas. */
const CORE_SHARE = 1 / 3;
/** A sentence shorter than this is a heading-like fragment, not a claim. */
const MIN_SENTENCE = 24;

export function citeWeights(panes: Panes): CiteWeights {
  const notes = new Map<string, number>();
  const bump = (anchor: string) => notes.set(anchor, (notes.get(anchor) ?? 0) + 1);
  const count = (blocks: readonly RenderBlock[]) => {
    walkSpans(blocks, (span) => span.cites.forEach(bump));
    blocks.forEach((block) => blockCites(block).forEach(bump));
  };
  if (panes.distillation) count(panes.distillation.blocks);
  panes.sections.forEach((s) => count(s.blocks));
  return { notes, summary: new Set(panes.summary ? collectCites(panes.summary.blocks) : []) };
}

interface Match {
  term: LexTerm;
  start: number;
  end: number;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One pattern per term: any of its forms, whole words, with an optional plural. */
export function termPattern(term: LexTerm): RegExp {
  const alternatives = term.forms.map((f) => escape(f).replace(/\s+/g, '\\s+')).join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives})(?:e?s)?(?![\\p{L}\\p{N}])`, 'giu');
}

/** Every non-overlapping term mention in `text`; longer mentions win where two overlap. */
export function findTerms(text: string, patterns: ReadonlyMap<LexTerm, RegExp>): Match[] {
  const all: Match[] = [];
  for (const [term, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) all.push({ term, start: m.index, end: m.index + m[0].length });
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  for (const m of all) {
    const last = out.at(-1);
    if (last && m.start < last.end) {
      if (m.end - m.start > last.end - last.start) out[out.length - 1] = m;
      continue;
    }
    out.push(m);
  }
  return out;
}

let segmenter: Intl.Segmenter | undefined;

/** Sentence ranges, never crossing a line break (list items, aside paragraphs), trailing space trimmed. */
export function sentences(text: string): { start: number; end: number }[] {
  segmenter ??= new Intl.Segmenter('en', { granularity: 'sentence' });
  const out: { start: number; end: number }[] = [];
  for (const piece of pieces(text, { stripMarkers: true })) {
    for (const s of segmenter.segment(text.slice(piece.start, piece.end))) {
      const start = piece.start + s.index + (s.segment.length - s.segment.trimStart().length);
      const end = piece.start + s.index + s.segment.trimEnd().length;
      if (end > start) out.push({ start, end });
    }
  }
  return out;
}

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

function whyPassage(notes: number, inSummary: boolean, defines: readonly string[]): string {
  const reasons = [
    inSummary ? 'The chapter summary rests on it' : null,
    notes > 0 ? `${plural(notes, 'claim')} in the notes ${notes === 1 ? 'cites' : 'cite'} it` : null,
    defines.length ? `It defines ${defines.slice(0, 2).join(' and ')}` : null,
  ].filter(Boolean);
  return reasons.join(' · ');
}

/** The sentence that best carries a block: most terms, then a definition, then the first. */
function bestSentence(text: string, mentions: readonly Match[], defined: ReadonlySet<LexTerm>) {
  const candidates = sentences(text).filter((s) => s.end - s.start >= MIN_SENTENCE);
  let best: { start: number; end: number } | null = null;
  let bestScore = -1;
  for (const s of candidates) {
    const inside = mentions.filter((m) => m.start >= s.start && m.end <= s.end);
    const score = inside.length + (inside.some((m) => defined.has(m.term)) ? 2 : 0);
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

function capitalised(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The marks for one chapter's blocks, in reading order. */
export function buildSalience(nodes: readonly TreeNode[], lexicon: readonly LexTerm[], weights: CiteWeights): Salient[] {
  const patterns = new Map(lexicon.map((t) => [t, termPattern(t)] as const));
  const blocks = nodes.filter((n) => TEXT_KINDS.has(n.kind) && n.text);
  const mentions = new Map(blocks.map((n) => [n.anchor, findTerms(n.text ?? '', patterns)] as const));
  const definedAt = (anchor: string) => new Set(lexicon.filter((t) => t.defines.includes(anchor)));

  // Sentences: rank blocks by how much the notes lean on them, keep the top share.
  const scored = blocks
    .map((node) => {
      const notes = weights.notes.get(node.anchor) ?? 0;
      const inSummary = weights.summary.has(node.anchor);
      const defines = [...definedAt(node.anchor)];
      return { node, notes, inSummary, defines, score: notes + (inSummary ? 3 : 0) + (defines.length ? 2 : 0) };
    })
    .filter((b) => b.score > 0)
    .sort((a, b) => b.score - a.score);
  const kept = scored.slice(0, Math.max(1, Math.round(blocks.length * SENTENCE_SHARE)));
  const cores = Math.max(1, Math.round(kept.length * CORE_SHARE));

  const out: Salient[] = [];
  kept.forEach((b, rank) => {
    const text = b.node.text ?? '';
    const s = bestSentence(text, mentions.get(b.node.anchor) ?? [], new Set(b.defines));
    if (!s) return;
    const tier: SalienceTier = rank < cores ? 'core' : 'key';
    out.push({
      id: `${b.node.anchor}@${s.start}`,
      anchor: b.node.anchor,
      start: s.start,
      end: s.end,
      tier,
      title: TIER_LABELS[tier],
      why: whyPassage(b.notes, b.inSummary, b.defines.map((t) => t.label)),
      gloss: null,
      source: 'heuristic',
    });
  });

  // Terms: one mark each, at the first mention in a block that defines it, else the first mention.
  const firsts = new Map<LexTerm, { anchor: string; match: Match; defining: boolean }>();
  for (const node of blocks) {
    for (const match of mentions.get(node.anchor) ?? []) {
      const defining = match.term.defines.includes(node.anchor);
      const known = firsts.get(match.term);
      if (!known || (defining && !known.defining)) firsts.set(match.term, { anchor: node.anchor, match, defining });
    }
  }
  for (const [term, { anchor, match, defining }] of firsts) {
    const kind = term.kind === 'term' ? 'Glossary term' : capitalised(term.kind);
    out.push({
      id: `${anchor}@${match.start}`,
      anchor,
      start: match.start,
      end: match.end,
      tier: 'term',
      title: capitalised(term.label),
      why: `${kind} · ${defining ? 'defined here' : 'first mention in this chapter'}`,
      gloss: term.gloss,
      source: 'heuristic',
    });
  }

  const order = new Map(nodes.map((n, i) => [n.anchor, i]));
  return out.sort((a, b) => (order.get(a.anchor) ?? 0) - (order.get(b.anchor) ?? 0) || a.start - b.start);
}

export type SalienceByAnchor = ReadonlyMap<string, readonly Salient[]>;

const NONE: readonly Salient[] = Object.freeze([]);

export function groupSalience(salients: readonly Salient[]): SalienceByAnchor {
  const out = new Map<string, Salient[]>();
  for (const s of salients) out.set(s.anchor, [...(out.get(s.anchor) ?? []), s]);
  return out;
}

export function salienceFor(groups: SalienceByAnchor, anchor: string): readonly Salient[] {
  return groups.get(anchor) ?? NONE;
}

/** Sentences count towards the key-ideas meter; terms don't. */
export function isIdea(s: Salient): boolean {
  return s.tier !== 'term';
}

/** A run of text under the same salient sentence and term, for rendering. */
export interface SalientRun {
  start: number;
  end: number;
  sentence: Salient | null;
  term: Salient | null;
}

/** Cut `[start, end)` at every salient boundary inside it. */
export function salientRuns(start: number, end: number, salients: readonly Salient[]): SalientRun[] {
  const inside = salients.filter((s) => s.end > start && s.start < end);
  if (inside.length === 0) return [{ start, end, sentence: null, term: null }];
  const cuts = new Set([start, end]);
  for (const s of inside) {
    if (s.start > start) cuts.add(s.start);
    if (s.end < end) cuts.add(s.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  return points.slice(1).map((to, i) => {
    const from = points[i] ?? start;
    const covering = inside.filter((s) => s.start <= from && s.end >= to);
    return {
      start: from,
      end: to,
      sentence: covering.find((s) => s.tier !== 'term') ?? null,
      term: covering.find((s) => s.tier === 'term') ?? null,
    };
  });
}

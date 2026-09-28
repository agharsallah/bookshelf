/**
 * The paper artifacts' bodies, read into typed shapes (tolerant of missing fields) and
 * flattened onto render blocks for the review queue and exports:
 *
 * - `paper_card` (dissect-paper): tldr, question, contributions by kind, method, setup
 *   (datasets, baselines, metrics), results, limitations stated vs unstated,
 *   assumptions, future work, numbers.
 * - `paper_explainer` (simplify-paper, one per level): prerequisites, intuition,
 *   walkthrough, analogy, equations in plain words.
 *
 * Shapes: skills/dissect-paper/schema.json, skills/simplify-paper/schema.json.
 */
import type { ClaimKind } from '../../lib/api/types/papers';
import { CLAIM_KINDS } from '../../lib/api/types/papers';
import type { MathBlock, RenderBlock, Spans } from '../../lib/contract';
import { blocks, isRecord, list, spans, str, strings, synthetic, type Json } from '../review/body/read';

/** A dataset, baseline or metric, with what the paper says about it. */
export interface Named {
  name: string;
  spans: Spans;
}

export interface KeyNumber {
  value: string;
  label: Spans;
}

export interface PaperCard {
  tldr: Spans;
  question: Spans;
  contributions: { kind: ClaimKind; spans: Spans }[];
  method: RenderBlock[];
  setup: { datasets: Named[]; baselines: Named[]; metrics: Named[] };
  results: RenderBlock[];
  limitations: { stated: Spans[]; unstated: Spans[] };
  assumptions: Spans[];
  futureWork: Spans[];
  numbers: KeyNumber[];
}

export const CONTRIBUTION_LABELS: Record<ClaimKind, string> = {
  method: 'Method',
  result: 'Result',
  theory: 'Theory',
  dataset: 'Dataset',
  benchmark: 'Benchmark',
  position: 'Position',
};

const isClaimKind = (v: unknown): v is ClaimKind => (CLAIM_KINDS as readonly unknown[]).includes(v);

const named = (v: unknown): Named[] =>
  list(v)
    .filter(isRecord)
    .map((n) => ({ name: str(n.name), spans: spans(n.spans) }))
    .filter((n) => n.name !== '');

const spanLists = (v: unknown): Spans[] => list(v).map(spans).filter((s) => s.length > 0);

export function parsePaperCard(raw: unknown): PaperCard {
  const body: Json = isRecord(raw) ? raw : {};
  const setup = isRecord(body.setup) ? body.setup : {};
  const limitations = isRecord(body.limitations) ? body.limitations : {};
  return {
    tldr: spans(body.tldr),
    question: spans(body.question),
    contributions: list(body.contributions)
      .filter(isRecord)
      .map((c) => ({ kind: isClaimKind(c.kind) ? c.kind : 'position', spans: spans(c.spans) }))
      .filter((c) => c.spans.length > 0),
    method: blocks(body.method),
    setup: { datasets: named(setup.datasets), baselines: named(setup.baselines), metrics: named(setup.metrics) },
    results: blocks(body.results),
    limitations: { stated: spanLists(limitations.stated), unstated: spanLists(limitations.unstated) },
    assumptions: spanLists(body.assumptions),
    futureWork: spanLists(body.future_work),
    numbers: list(body.numbers)
      .filter(isRecord)
      .map((n) => ({ value: str(n.value), label: spans(n.label) }))
      .filter((n) => n.value !== ''),
  };
}

/** Contributions in the vocabulary's order (method first), each kind with its items. */
export function contributionsByKind(card: Pick<PaperCard, 'contributions'>): { kind: ClaimKind; label: string; items: Spans[] }[] {
  return CLAIM_KINDS.map((kind) => ({
    kind,
    label: CONTRIBUTION_LABELS[kind],
    items: card.contributions.filter((c) => c.kind === kind).map((c) => c.spans),
  })).filter((group) => group.items.length > 0);
}

const heading = (text: string, level: 2 | 3 = 2): RenderBlock => ({ type: 'heading', level, text });
const bullets = (items: Spans[]): RenderBlock[] => (items.length > 0 ? [{ type: 'bullets', items }] : []);
const section = (title: string, body: RenderBlock[]): RenderBlock[] => (body.length > 0 ? [heading(title), ...body] : []);
const namedItems = (items: Named[]): Spans[] => items.map((n) => [synthetic(`${n.name}: `, 'strong'), ...n.spans]);

/** The card in page order, as render blocks (the review queue draws this). */
export function paperCardBlocks(card: PaperCard): RenderBlock[] {
  const { datasets, baselines, metrics } = card.setup;
  const setup = [
    ...(datasets.length ? [heading('Datasets', 3), ...bullets(namedItems(datasets))] : []),
    ...(baselines.length ? [heading('Baselines', 3), ...bullets(namedItems(baselines))] : []),
    ...(metrics.length ? [heading('Metrics', 3), ...bullets(namedItems(metrics))] : []),
  ];
  const { stated, unstated } = card.limitations;
  return [
    ...section('In short', card.tldr.length ? [{ type: 'paragraph', spans: card.tldr }] : []),
    ...section('The question', card.question.length ? [{ type: 'paragraph', spans: card.question }] : []),
    ...section(
      'Contributions',
      bullets(contributionsByKind(card).flatMap((g) => g.items.map((item) => [synthetic(`${g.label}: `, 'strong'), ...item]))),
    ),
    ...section('Method', card.method),
    ...section('Setup', setup),
    ...section('Results', card.results),
    ...section('Numbers', bullets(card.numbers.map((n) => [synthetic(`${n.value} `, 'strong'), ...n.label]))),
    ...section('Limitations', [
      ...(stated.length ? [heading('Stated by the authors', 3), ...bullets(stated)] : []),
      ...(unstated.length ? [heading('Not stated', 3), ...bullets(unstated)] : []),
    ]),
    ...section('Assumptions', bullets(card.assumptions)),
    ...section('Future work', bullets(card.futureWork)),
  ];
}

export interface Prerequisite {
  concept: string;
  /** The shelf concept's canonical name it matches, if any. */
  shelfConcept: string | null;
  why: Spans;
}

export interface PaperExplainer {
  prerequisites: Prerequisite[];
  intuition: RenderBlock[];
  walkthrough: RenderBlock[];
  analogy: Spans | null;
  equations: MathBlock[];
}

export function parseExplainer(raw: unknown): PaperExplainer {
  const body: Json = isRecord(raw) ? raw : {};
  const analogy = spans(body.analogy);
  return {
    prerequisites: list(body.prerequisites)
      .filter(isRecord)
      .map((p) => ({ concept: str(p.concept), shelfConcept: str(p.shelf_concept) || null, why: spans(p.why) }))
      .filter((p) => p.concept !== ''),
    intuition: blocks(body.intuition),
    walkthrough: blocks(body.walkthrough),
    analogy: analogy.length > 0 ? analogy : null,
    equations: list(body.equations)
      .filter(isRecord)
      .filter((e) => str(e.latex) !== '')
      .map((e): MathBlock => ({ type: 'math', latex: str(e.latex), meaning: spans(e.plain), cites: strings(e.cites) })),
  };
}

/** The explainer as render blocks: prerequisites as definitions, the analogy as a callout. */
export function explainerBlocks(explainer: PaperExplainer): RenderBlock[] {
  return [
    ...section(
      'What you need to know first',
      explainer.prerequisites.map((p): RenderBlock => ({ type: 'definition', term: p.concept, spans: p.why })),
    ),
    ...section('The idea', explainer.intuition),
    ...section('Walkthrough', explainer.walkthrough),
    ...(explainer.analogy ? [{ type: 'callout', tone: 'insight', title: 'An analogy', spans: explainer.analogy } as RenderBlock] : []),
    ...section('Key equations', explainer.equations),
  ];
}

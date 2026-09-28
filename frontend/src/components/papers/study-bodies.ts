/**
 * The study and critique artifacts' bodies, read tolerantly into typed shapes and
 * flattened onto render blocks for the review queue (`adaptBody`):
 *
 * - `paper_assessment` (assess-paper): overall, six rubric scores, a ten-item
 *   reproducibility checklist, related shelf papers.
 * - `paper_review` (review-paper): summary, strengths, weaknesses by severity, questions,
 *   missing experiments, verdict with confidence.
 * - `notation_table` (make-notation): symbols in order of first use.
 * - `journal_club` (make-journal-club): pitch, key figure, weakest assumption, questions,
 *   the debate for and against.
 *
 * Shapes: skills/<name>/schema.json (and PROGRESS "Phase 2B" in the build notes).
 */
import { ASSESSMENT_CRITERIA, REPRODUCIBILITY_STATUSES, type AssessmentCriterion, type ReproducibilityStatus } from '../../lib/api/types/papers';
import {
  RECOMMENDATIONS,
  REPRODUCIBILITY_ITEMS,
  type Recommendation,
  type ReproducibilityItem,
  type ReviewSeverity,
} from '../../lib/api/types/paperStudy';
import type { RenderBlock, Span, Spans } from '../../lib/contract';
import { isRecord, list, spans, str, strings, synthetic, type Json } from '../review/body/read';
import { CRITERION_LABELS, ITEM_LABELS, RECOMMENDATION_LABELS, STATUS_LABELS } from './study-labels';

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (v: unknown): v is T =>
    (values as readonly unknown[]).includes(v);

const record = (v: unknown): Json => (isRecord(v) ? v : {});
const spanLists = (v: unknown): Spans[] => list(v).map(spans).filter((s) => s.length > 0);
const clampScore = (v: unknown, max = 5): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.round(v))) : 0);

// ── Assessment ─────────────────────────────────────────────────────────────────────

export interface CriterionScore {
  criterion: AssessmentCriterion;
  /** 1–5; 0 when the body gave none. */
  score: number;
  spans: Spans;
}

export interface ChecklistItem {
  item: ReproducibilityItem;
  status: ReproducibilityStatus;
  spans: Spans;
}

export interface RelatedPaper {
  slug: string;
  why: Spans;
}

export interface PaperAssessment {
  overall: Spans;
  scores: CriterionScore[];
  reproducibility: ChecklistItem[];
  relatedShelf: RelatedPaper[];
}

const isCriterion = oneOf(ASSESSMENT_CRITERIA);
const isItem = oneOf(REPRODUCIBILITY_ITEMS);
const isStatus = oneOf(REPRODUCIBILITY_STATUSES);

/** Scores in the rubric's order whatever order the body used; unknown criteria dropped. */
export function parseAssessment(raw: unknown): PaperAssessment {
  const body = record(raw);
  const scores = list(body.scores)
    .filter(isRecord)
    .flatMap((s) => (isCriterion(s.criterion) ? [{ criterion: s.criterion, score: clampScore(s.score), spans: spans(s.spans) }] : []));
  const checklist = list(body.reproducibility)
    .filter(isRecord)
    .flatMap((r) => (isItem(r.item) ? [{ item: r.item, status: isStatus(r.status) ? r.status : 'unknown', spans: spans(r.spans) }] : []));
  return {
    overall: spans(body.overall),
    scores: ASSESSMENT_CRITERIA.flatMap((c) => scores.filter((s) => s.criterion === c).slice(0, 1)),
    reproducibility: REPRODUCIBILITY_ITEMS.flatMap((i) => checklist.filter((r) => r.item === i).slice(0, 1)),
    relatedShelf: list(body.related_shelf)
      .filter(isRecord)
      .map((r) => ({ slug: str(r.slug), why: spans(r.why) }))
      .filter((r) => r.slug !== ''),
  };
}

export function assessmentBlocks(a: PaperAssessment): RenderBlock[] {
  return [
    ...section('Overall', a.overall.length ? [{ type: 'paragraph', spans: a.overall }] : []),
    ...section(
      'Scores',
      a.scores.length
        ? [
            {
              type: 'table',
              header: ['Criterion', 'Score', 'Why'],
              rows: a.scores.map((s) => [synthetic(CRITERION_LABELS[s.criterion]), synthetic(`${s.score} / 5`), oneSpan(s.spans)]),
            },
          ]
        : [],
    ),
    ...section(
      'Reproducibility',
      bullets(a.reproducibility.map((r) => [synthetic(`${ITEM_LABELS[r.item]} (${STATUS_LABELS[r.status].toLowerCase()}): `, 'strong'), ...r.spans])),
    ),
    ...section('Related on your shelf', bullets(a.relatedShelf.map((r) => [synthetic(`${r.slug}: `, 'strong'), ...r.why]))),
  ];
}

// ── Peer review ────────────────────────────────────────────────────────────────────

export interface Weakness {
  severity: ReviewSeverity;
  spans: Spans;
}

export interface ReviewVerdict {
  recommendation: Recommendation | null;
  /** 1–5; 0 when missing. */
  confidence: number;
  spans: Spans;
}

export interface PaperReview {
  summary: Spans;
  strengths: Spans[];
  weaknesses: Weakness[];
  questions: Spans[];
  missingExperiments: Spans[];
  verdict: ReviewVerdict;
}

const isRecommendation = oneOf(RECOMMENDATIONS);

/** Major weaknesses first (stable within a severity), as a reviewer would read them. */
export function parseReview(raw: unknown): PaperReview {
  const body = record(raw);
  const verdict = record(body.verdict);
  const weaknesses = list(body.weaknesses)
    .filter(isRecord)
    .map((w): Weakness => ({ severity: w.severity === 'major' ? 'major' : 'minor', spans: spans(w.spans) }))
    .filter((w) => w.spans.length > 0);
  return {
    summary: spans(body.summary),
    strengths: spanLists(body.strengths),
    weaknesses: [...weaknesses.filter((w) => w.severity === 'major'), ...weaknesses.filter((w) => w.severity === 'minor')],
    questions: spanLists(body.questions),
    missingExperiments: spanLists(body.missing_experiments),
    verdict: {
      recommendation: isRecommendation(verdict.recommendation) ? verdict.recommendation : null,
      confidence: clampScore(verdict.confidence),
      spans: spans(verdict.spans),
    },
  };
}

export function reviewBlocks(r: PaperReview): RenderBlock[] {
  const verdictTitle = r.verdict.recommendation
    ? `${RECOMMENDATION_LABELS[r.verdict.recommendation]}${r.verdict.confidence ? `, confidence ${r.verdict.confidence} of 5` : ''}`
    : 'Verdict';
  return [
    ...section('Summary', r.summary.length ? [{ type: 'paragraph', spans: r.summary }] : []),
    ...section('Strengths', bullets(r.strengths)),
    ...section('Weaknesses', bullets(r.weaknesses.map((w) => [synthetic(`${w.severity === 'major' ? 'Major' : 'Minor'}: `, 'strong'), ...w.spans]))),
    ...section('Questions for the authors', bullets(r.questions)),
    ...section('Missing experiments', bullets(r.missingExperiments)),
    ...(r.verdict.spans.length || r.verdict.recommendation
      ? [{ type: 'callout', tone: 'insight', title: verdictTitle, spans: r.verdict.spans } as RenderBlock]
      : []),
  ];
}

// ── Notation ───────────────────────────────────────────────────────────────────────

export interface NotationSymbol {
  latex: string;
  meaning: string;
  /** Where the paper first uses it. */
  firstAnchor: string | null;
  cites: string[];
}

export function parseNotation(raw: unknown): NotationSymbol[] {
  return list(record(raw).symbols)
    .filter(isRecord)
    .map((s) => ({ latex: str(s.symbol_latex), meaning: str(s.meaning), firstAnchor: str(s.first_anchor) || null, cites: strings(s.cites) }))
    .filter((s) => s.latex !== '');
}

export function notationBlocks(symbols: readonly NotationSymbol[]): RenderBlock[] {
  return symbols.map((s): RenderBlock => ({ type: 'math', latex: s.latex, meaning: [{ text: s.meaning, cites: s.cites }], cites: s.firstAnchor ? [s.firstAnchor] : [] }));
}

// ── Journal club ───────────────────────────────────────────────────────────────────

export interface JournalClub {
  pitch: Spans;
  keyFigure: { anchor: string; why: Spans } | null;
  weakestAssumption: Spans;
  questions: Spans[];
  debate: { for: Spans[]; against: Spans[] };
}

export function parseJournalClub(raw: unknown): JournalClub {
  const body = record(raw);
  const figure = isRecord(body.key_figure) ? body.key_figure : null;
  const debate = record(body.debate);
  return {
    pitch: spans(body.pitch),
    keyFigure: figure && str(figure.anchor) ? { anchor: str(figure.anchor), why: spans(figure.why) } : null,
    weakestAssumption: spans(record(body.weakest_assumption).spans),
    questions: spanLists(body.questions),
    debate: { for: spanLists(debate.for), against: spanLists(debate.against) },
  };
}

export function journalClubBlocks(club: JournalClub): RenderBlock[] {
  return [
    ...section('The pitch', club.pitch.length ? [{ type: 'paragraph', spans: club.pitch }] : []),
    ...section(
      'Key figure',
      club.keyFigure ? [{ type: 'paragraph', spans: [synthetic(`${club.keyFigure.anchor}: `, 'strong'), ...club.keyFigure.why] }] : [],
    ),
    ...(club.weakestAssumption.length ? [{ type: 'callout', tone: 'caution', title: 'Weakest assumption', spans: club.weakestAssumption } as RenderBlock] : []),
    ...section('Questions for the room', club.questions.length ? [{ type: 'steps', items: club.questions } as RenderBlock] : []),
    ...section('For', bullets(club.debate.for)),
    ...section('Against', bullets(club.debate.against)),
  ];
}

// ── Shared block helpers ───────────────────────────────────────────────────────────

/** Spans as one table cell: the text run together, every cite kept. */
export function oneSpan(runs: Spans): Span {
  return { text: runs.map((r) => r.text).join(' ').replace(/\s+/g, ' ').trim(), cites: [...new Set(runs.flatMap((r) => r.cites))] };
}

export function heading(text: string, level: 2 | 3 = 2): RenderBlock {
  return { type: 'heading', level, text };
}

export function bullets(items: Spans[]): RenderBlock[] {
  return items.length > 0 ? [{ type: 'bullets', items }] : [];
}

export function section(title: string, body: RenderBlock[]): RenderBlock[] {
  return body.length > 0 ? [heading(title), ...body] : [];
}

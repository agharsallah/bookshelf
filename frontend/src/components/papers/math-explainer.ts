/**
 * The math explainer (skills/explain-math, `math_explainer`), read tolerantly into a typed
 * view model for the "Math, explained" tab, and flattened onto render blocks for the
 * review queue (`adaptBody`). Pure: no rendering, no fetching.
 *
 * Shape (skills/explain-math/schema.json): `big_picture {problem, map}`, `formulas[]` in
 * learning order (each read aloud, its symbols, intuition, diagram, worked example, why
 * here, what it buys, a caution, try it, explore further), `glossary`, `love_note`, `path`.
 */
import type { CalloutBlock, ChartBlock, DefinitionBlock, DiagramBlock, RenderBlock, Spans, StepsBlock, TableBlock } from '../../lib/contract';
import { isRecord, list, spans, str, strings, synthetic, type Json } from '../review/body/read';
import { bullets, heading, section } from './study-bodies';
import { paperHref } from './tabs';

export interface ExplainedSymbol {
  latex: string;
  everyday: Spans;
  /** Inline KaTeX, pre-rendered in frontmatter; without it the LaTeX source shows. */
  html?: string | undefined;
}

export interface WorkedExample {
  setup: Spans;
  steps: StepsBlock | null;
  result: Spans;
  /** How the output moves as one input changes, when the skill drew it. */
  extra: TableBlock | ChartBlock | null;
}

export interface ExploreFurther {
  prerequisites: { concept: string; shelfConcept: string | null }[];
  searchTerms: string[];
  nextQuestion: Spans;
}

export interface ExplainedFormula {
  anchor: string;
  latex: string;
  name: string;
  inPlainWords: Spans;
  symbols: ExplainedSymbol[];
  intuition: Spans;
  diagram: DiagramBlock | null;
  example: WorkedExample;
  whyHere: Spans;
  addedValue: Spans;
  confusion: CalloutBlock | null;
  tryIt: { question: Spans; answer: Spans };
  explore: ExploreFurther;
}

export interface PathStep {
  title: string;
  /** The formula the step studies (one of `formulas[].anchor`), or null for a warm-up. */
  formula: string | null;
  minutes: number;
  goal: Spans;
}

export interface MathExplainer {
  problem: Spans;
  map: DiagramBlock | null;
  formulas: ExplainedFormula[];
  glossary: DefinitionBlock[];
  loveNote: CalloutBlock | null;
  path: PathStep[];
}

const record = (v: unknown): Json => (isRecord(v) ? v : {});
const blockOf = <T extends RenderBlock['type']>(type: T, v: unknown): Extract<RenderBlock, { type: T }> | null =>
  isRecord(v) && v.type === type ? (v as unknown as Extract<RenderBlock, { type: T }>) : null;

function parseFormula(raw: Json): ExplainedFormula {
  const example = record(raw.worked_example);
  const tryIt = record(raw.try_it);
  const explore = record(raw.explore_further);
  return {
    anchor: str(raw.anchor),
    latex: str(raw.latex),
    name: str(raw.name) || 'A formula',
    inPlainWords: spans(raw.in_plain_words),
    symbols: list(raw.symbols)
      .filter(isRecord)
      .map((s) => ({ latex: str(s.symbol), everyday: spans(s.everyday) }))
      .filter((s) => s.latex !== ''),
    intuition: spans(raw.intuition),
    diagram: blockOf('diagram', raw.diagram),
    example: {
      setup: spans(example.setup),
      steps: blockOf('steps', example.steps),
      result: spans(example.result),
      extra: blockOf('table', example.extra) ?? blockOf('chart', example.extra),
    },
    whyHere: spans(raw.why_here),
    addedValue: spans(raw.added_value),
    confusion: blockOf('callout', raw.common_confusion),
    tryIt: { question: spans(tryIt.question), answer: spans(tryIt.answer) },
    explore: {
      prerequisites: list(explore.prerequisites)
        .filter(isRecord)
        .map((p) => ({ concept: str(p.concept), shelfConcept: str(p.shelf_concept) || null }))
        .filter((p) => p.concept !== ''),
      searchTerms: strings(explore.search_terms).filter((t) => t.trim() !== ''),
      nextQuestion: spans(explore.next_question),
    },
  };
}

export function parseMathExplainer(raw: unknown): MathExplainer {
  const body = record(raw);
  const picture = record(body.big_picture);
  return {
    problem: spans(picture.problem),
    map: blockOf('diagram', picture.map),
    formulas: list(body.formulas)
      .filter(isRecord)
      .map(parseFormula)
      .filter((f) => f.latex !== '' || f.anchor !== ''),
    glossary: list(body.glossary).flatMap((g) => blockOf('definition', g) ?? []),
    loveNote: blockOf('callout', body.love_note),
    path: list(body.path)
      .filter(isRecord)
      .map((p) => ({
        title: str(p.title),
        formula: str(p.formula) || null,
        minutes: typeof p.minutes === 'number' && Number.isFinite(p.minutes) ? Math.max(0, Math.round(p.minutes)) : 0,
        goal: spans(p.goal),
      }))
      .filter((p) => p.title !== ''),
  };
}

/** Symbols with their inline KaTeX attached (`render` never throws for bad LaTeX, but a
 * failure leaves the source showing). */
export async function renderSymbols(m: MathExplainer, render: (latex: string) => Promise<string>): Promise<MathExplainer> {
  const formulas = await Promise.all(
    m.formulas.map(async (f) => ({
      ...f,
      symbols: await Promise.all(f.symbols.map(async (s) => ({ ...s, html: await render(s.latex).catch(() => undefined) }))),
    })),
  );
  return { ...m, formulas };
}

// ── Links ────────────────────────────────────────────────────────────────────────

/** The id of a formula's card on the tab: `ch03/s01/m001` → `formula-ch03-s01-m001`. */
export function formulaId(anchor: string): string {
  return `formula-${anchor.replace(/[^a-z0-9]+/gi, '-')}`;
}

/** The "Math, explained" tab, scrolled to one formula's card when an anchor is given. */
export function mathHref(slug: string, anchor?: string | null): string {
  return `${paperHref(slug, 'math')}${anchor ? `#${formulaId(anchor)}` : ''}`;
}

/** A formula block's anchor (`…/m003`, the parser's math leaves). */
export const isFormulaAnchor = (anchor: string): boolean => /(^|\/)m\d+$/.test(anchor);

/** Where a notation symbol is used in a formula: its first use, else its first cited formula. */
export function formulaAnchorOf(symbol: { firstAnchor: string | null; cites: readonly string[] }): string | null {
  return [symbol.firstAnchor, ...symbol.cites].find((a): a is string => Boolean(a) && isFormulaAnchor(a ?? '')) ?? null;
}

// ── The learning path ────────────────────────────────────────────────────────────

export interface PathItem extends PathStep {
  /** 1-based number of the formula card the step studies, when it names one. */
  formulaNumber: number | null;
  formulaName: string | null;
}

export function pathItems(m: Pick<MathExplainer, 'path' | 'formulas'>): PathItem[] {
  return m.path.map((step) => {
    const index = step.formula ? m.formulas.findIndex((f) => f.anchor === step.formula) : -1;
    const formula = index >= 0 ? m.formulas[index] : undefined;
    return { ...step, formulaNumber: formula ? index + 1 : null, formulaName: formula?.name ?? null };
  });
}

export const totalMinutes = (path: readonly Pick<PathStep, 'minutes'>[]): number => path.reduce((sum, s) => sum + s.minutes, 0);

/** "1 h 5 min", "40 min". */
export function minutesLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

// ── Review queue ─────────────────────────────────────────────────────────────────

const labelled = (label: string, runs: Spans): Spans[] => (runs.length ? [[synthetic(`${label} `, 'strong'), ...runs]] : []);

function formulaBlocks(f: ExplainedFormula, n: number): RenderBlock[] {
  const out: RenderBlock[] = [heading(`${n}. ${f.name}`, 3)];
  if (f.latex) out.push({ type: 'math', latex: f.latex, meaning: f.inPlainWords, cites: f.anchor ? [f.anchor] : [] });
  out.push(...bullets(f.symbols.map((s) => [synthetic(`${s.latex}: `, 'code'), ...s.everyday])));
  if (f.intuition.length) out.push({ type: 'paragraph', spans: [synthetic('Why this shape: ', 'strong'), ...f.intuition] });
  if (f.diagram) out.push(f.diagram);
  if (f.example.setup.length) out.push({ type: 'paragraph', spans: [synthetic('Worked example: ', 'strong'), ...f.example.setup] });
  if (f.example.steps) out.push(f.example.steps);
  if (f.example.result.length) out.push({ type: 'paragraph', spans: [synthetic('So: ', 'strong'), ...f.example.result] });
  if (f.example.extra) out.push(f.example.extra);
  out.push(...bullets([...labelled('Why the paper needs it:', f.whyHere), ...labelled('What it buys:', f.addedValue)]));
  if (f.confusion) out.push(f.confusion);
  out.push(...bullets([...labelled('Try it:', f.tryIt.question), ...labelled('Answer:', f.tryIt.answer), ...labelled('Next question:', f.explore.nextQuestion)]));
  return out;
}

export function mathExplainerBlocks(m: MathExplainer): RenderBlock[] {
  const path = pathItems(m);
  return [
    ...section('The big picture', [...(m.problem.length ? [{ type: 'paragraph', spans: m.problem } as RenderBlock] : []), ...(m.map ? [m.map] : [])]),
    ...m.formulas.flatMap((f, i) => formulaBlocks(f, i + 1)),
    ...section(
      `Learning path (${minutesLabel(totalMinutes(m.path))})`,
      path.length ? [{ type: 'steps', items: path.map((p) => [synthetic(`${p.title} (${p.minutes} min): `, 'strong'), ...p.goal]) }] : [],
    ),
    ...section('Glossary', m.glossary),
    ...(m.loveNote ? [m.loveNote] : []),
  ];
}

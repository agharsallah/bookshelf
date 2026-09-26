/**
 * Study artifact bodies → the typed items the study islands draw. Each parser is
 * forgiving (a malformed item is dropped, never thrown on), so a hand-edited or older
 * body still shows what it can. Shapes follow the make-* / extract-quotes skill schemas.
 */
import type { DefinitionBlock, QuoteBlock, RenderBlock, Span, Spans } from '../../lib/contract';

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strings = (v: unknown): string[] => list(v).filter((s): s is string => typeof s === 'string');

export function spansOf(v: unknown): Spans {
  return list(v)
    .filter(isRecord)
    .map((s) => ({
      text: str(s.text),
      cites: strings(s.cites),
      ...(typeof s.mark === 'string' ? { mark: s.mark as Span['mark'] } : {}),
    }));
}

/** An item's book-wide topic, or null when it has none. */
function groupOf(item: Json): string | null {
  const group = str(item.group).trim();
  return group || null;
}

export interface Flashcard {
  front: string;
  back: Spans;
  group: string | null;
}

export interface QuizQuestion {
  question: string;
  choices: string[];
  /** 0-based index into `choices`. */
  answer: number;
  explanation: Spans;
}

export interface FaqItem {
  question: string;
  answer: Spans;
  group: string | null;
  /** Steps, bullets, a table or a callout beneath the direct answer. */
  detail: RenderBlock[];
}

export function parseFlashcards(body: unknown): Flashcard[] {
  const items = isRecord(body) ? list(body.items) : [];
  return items
    .filter(isRecord)
    .map((item) => ({ front: str(item.front), back: spansOf(item.back), group: groupOf(item) }))
    .filter((card) => card.front !== '');
}

export function parseQuiz(body: unknown): QuizQuestion[] {
  const items = isRecord(body) ? list(body.items) : [];
  return items.filter(isRecord).flatMap((item) => {
    const choices = strings(item.choices);
    const answer = typeof item.answer === 'number' ? item.answer : -1;
    const question = str(item.question);
    if (!question || choices.length < 2 || answer < 0 || answer >= choices.length) return [];
    return [{ question, choices, answer, explanation: spansOf(item.explanation) }];
  });
}

export function parseFaq(body: unknown): FaqItem[] {
  const items = isRecord(body) ? list(body.items) : [];
  return items
    .filter(isRecord)
    .map((item) => ({
      question: str(item.question),
      answer: spansOf(item.answer),
      group: groupOf(item),
      detail: list(item.detail).filter(isRecord) as unknown as RenderBlock[],
    }))
    .filter((item) => item.question !== '');
}

function blocksOf(body: unknown): Json[] {
  return isRecord(body) ? list(body.blocks).filter(isRecord) : [];
}

export function parseQuotes(body: unknown): QuoteBlock[] {
  return blocksOf(body)
    .filter((b) => b.type === 'quote' && str(b.text) !== '')
    .map((b) => ({
      type: 'quote',
      text: str(b.text),
      ...(str(b.attribution) ? { attribution: str(b.attribution) } : {}),
      cites: strings(b.cites),
      page: typeof b.page === 'number' ? b.page : null,
    }));
}

export function parseGlossary(body: unknown): DefinitionBlock[] {
  return blocksOf(body)
    .filter((b) => b.type === 'definition' && str(b.term).trim() !== '')
    .map((b) => ({ type: 'definition', term: str(b.term).trim(), spans: spansOf(b.spans) }));
}

/** Plain text of spans, for filtering and copying. */
export function plainText(spans: readonly Span[]): string {
  return spans.map((s) => s.text).join(' ');
}

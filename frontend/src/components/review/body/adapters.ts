/**
 * Body → render blocks. Most artifact bodies are `{blocks}`; the rest (brief sections,
 * quiz/faq/flashcards items, figure and formula descriptions, concept links, outlines,
 * audio summary scripts)
 * are mapped onto the closed block set here so `<Blocks>` draws every artifact.
 *
 * Text the adapter adds (a quiz choice, a concept name) is not a claim the skill made,
 * so it is registered as *synthetic* and never counted or marked as uncited.
 */
import type { ArtifactType } from '../../../lib/api/types/artifacts';
import type { Confidence, RenderBlock, Spans } from '../../../lib/contract';
import { ROLE_LABELS, parseGuide, type GuideKey } from '../../guide/guide';
import { explainerBlocks, paperCardBlocks, parseExplainer, parsePaperCard } from '../../papers/bodies';
import { claimSetBlocks, intentsBlocks, parseClaimSet, parseIntents, parseResults, resultsBlocks } from '../../papers/extract-bodies';
import {
  assessmentBlocks,
  journalClubBlocks,
  notationBlocks,
  parseAssessment,
  parseJournalClub,
  parseNotation,
  parseReview,
  reviewBlocks,
} from '../../papers/study-bodies';
import { RECOMMENDATION_LABELS } from '../../papers/study-labels';
import { blocks, isRecord, list, spans, str, synthetic, type Json } from './read';

export { isSynthetic, synthetic } from './read';

export interface BodyFact {
  label: string;
  value: string;
}

export interface AdaptedBody {
  blocks: RenderBlock[];
  /** Non-claim metadata shown above the body: kind, caption, tags, concepts… */
  facts: BodyFact[];
  confidence: Confidence | null;
}

function confidenceOf(body: Json): Confidence | null {
  const c = body.confidence;
  return c === 'high' || c === 'medium' || c === 'low' ? c : null;
}

function joined(v: unknown): string {
  return list(v).filter((x): x is string => typeof x === 'string').join(', ');
}

function fact(label: string, value: string): BodyFact[] {
  return value ? [{ label, value }] : [];
}

function brief(body: Json): RenderBlock[] {
  const out: RenderBlock[] = [];
  for (const section of list(body.sections).filter(isRecord)) {
    if (section.key === 'read_next') continue;
    out.push({ type: 'heading', level: 2, text: str(section.title) }, ...blocks(section.blocks));
  }
  const next = list(body.read_next).filter(isRecord);
  if (next.length > 0) {
    out.push(
      { type: 'heading', level: 2, text: 'Read next' },
      { type: 'bullets', items: next.map((item) => [synthetic(str(item.slug), 'strong'), ...spans(item.reason)]) },
    );
  }
  return out;
}

/** The guide in page order: its block sections, with the journey, themes and numbers as lists. */
function guide(body: Json): RenderBlock[] {
  const parsed = parseGuide(body);
  if (!parsed) return [];
  const section = (key: GuideKey): RenderBlock[] => {
    const found = parsed.sections.find((s) => s.key === key);
    return found ? [{ type: 'heading', level: 2, text: found.title }, ...found.blocks] : [];
  };
  const list = (title: string, items: Spans[]): RenderBlock[] =>
    items.length > 0 ? [{ type: 'heading', level: 2, text: title }, { type: 'bullets', items }] : [];
  return [
    ...section('overview'),
    ...list(
      'Numbers to remember',
      parsed.numbers.map((n) => [synthetic(n.value, 'strong'), ...n.label]),
    ),
    ...section('map'),
    ...list(
      'Chapter by chapter',
      parsed.journey.map((j) => [synthetic(`${j.anchor} · ${j.role ? ROLE_LABELS[j.role] : 'no role'}`, 'strong'), ...j.takeaway]),
    ),
    ...(parsed.themes.length > 0 ? [{ type: 'heading', level: 2, text: 'Themes' } as RenderBlock] : []),
    ...parsed.themes.map((t): RenderBlock => ({ type: 'definition', term: t.name, spans: t.spans })),
    ...section('deep_dive'),
    ...section('practice'),
  ];
}

function quiz(body: Json): RenderBlock[] {
  return list(body.items)
    .filter(isRecord)
    .flatMap((item, n): RenderBlock[] => {
      const answer = typeof item.answer === 'number' ? item.answer : -1;
      const choices = list(item.choices).map((choice, i) =>
        i === answer ? [synthetic(str(choice), 'strong'), synthetic('— correct', 'em')] : [synthetic(str(choice))],
      );
      return [
        { type: 'heading', level: 3, text: `${n + 1}. ${str(item.question)}` },
        { type: 'bullets', items: choices },
        { type: 'paragraph', spans: spans(item.explanation) },
      ];
    });
}

/** A level-2 heading wherever an item's `group` (a book-wide topic) differs from the last. */
function grouped(items: Json[], draw: (item: Json) => RenderBlock[]): RenderBlock[] {
  let current = '';
  return items.flatMap((item) => {
    const group = str(item.group);
    const heading: RenderBlock[] = group && group !== current ? [{ type: 'heading', level: 2, text: group }] : [];
    current = group || current;
    return [...heading, ...draw(item)];
  });
}

function faq(body: Json): RenderBlock[] {
  return grouped(list(body.items).filter(isRecord), (item) => [
    { type: 'heading', level: 3, text: str(item.question) },
    { type: 'paragraph', spans: spans(item.answer) },
    ...blocks(item.detail),
  ]);
}

function flashcards(body: Json): RenderBlock[] {
  return grouped(list(body.items).filter(isRecord), (item) => [{ type: 'definition', term: str(item.front), spans: spans(item.back) }]);
}

/** An audio summary script: each part a heading, each turn who says it, then what. */
function audioScript(body: Json): RenderBlock[] {
  const speakers = list(body.speakers).filter(isRecord).map((s) => str(s.role) || 'Speaker');
  return list(body.sections)
    .filter(isRecord)
    .flatMap((section): RenderBlock[] => [
      { type: 'heading', level: 3, text: str(section.title) },
      ...list(section.turns)
        .filter(isRecord)
        .map((turn): RenderBlock => ({
          type: 'paragraph',
          spans: [synthetic(`${speakers[Number(turn.speaker) - 1] ?? `Speaker ${String(turn.speaker)}`}: `), ...spans([turn])],
        })),
    ]);
}

function endpoint(v: unknown): string {
  if (!isRecord(v)) return '?';
  return v.kind === 'node' ? `passage ${str(v.ref)}` : str(v.ref);
}

function conceptLinks(body: Json): RenderBlock[] {
  const concepts = list(body.concepts)
    .filter(isRecord)
    .map((c): RenderBlock => ({ type: 'definition', term: str(c.canonical), spans: spans(c.blurb) }));
  const edges = list(body.edges).filter(isRecord);
  if (edges.length === 0) return concepts;
  const evidence = (e: Json) => list(e.evidence).filter((a): a is string => typeof a === 'string');
  return [
    ...concepts,
    { type: 'heading', level: 3, text: 'Proposed edges' },
    {
      type: 'table',
      header: ['From', 'Relation', 'To', 'Evidence'],
      rows: edges.map((e) => [
        synthetic(endpoint(e.src)),
        synthetic(str(e.relation).replaceAll('_', ' ')),
        synthetic(endpoint(e.dst)),
        { text: `${evidence(e).length} passage${evidence(e).length === 1 ? '' : 's'}`, cites: evidence(e) },
      ]),
    },
  ];
}

/** Salience marks: what each marks, in the book's words (cited), and why. */
function salienceMarks(body: Json): RenderBlock[] {
  const marks = list(body.marks).filter(isRecord);
  if (marks.length === 0) return [];
  return [
    {
      type: 'table',
      header: ['Mark', 'Passage', 'Why'],
      rows: marks.map((m) => [
        synthetic(str(m.tier)),
        { text: str(m.text), cites: list(m.cites).filter((c): c is string => typeof c === 'string') },
        synthetic(str(m.why)),
      ]),
    },
  ];
}

function outline(body: Json): RenderBlock[] {
  const chapters = list(body.chapters).filter(isRecord);
  return [
    {
      type: 'table',
      header: ['Chapter', 'Pages', 'Sections'],
      rows: chapters.map((c) => [
        synthetic(str(c.title)),
        synthetic(`${String(c.page_from ?? '?')}–${String(c.page_to ?? '?')}`),
        synthetic(String(list(c.sections).length)),
      ]),
    },
  ];
}

export function adaptBody(type: ArtifactType, raw: unknown): AdaptedBody {
  const body = isRecord(raw) ? raw : {};
  const confidence = confidenceOf(body);
  switch (type) {
    case 'book_brief':
      return { blocks: brief(body), facts: [], confidence };
    case 'book_guide':
      return { blocks: guide(body), facts: [], confidence };
    case 'quiz':
      return { blocks: quiz(body), facts: [], confidence };
    case 'faq':
      return { blocks: faq(body), facts: [], confidence };
    case 'flashcards':
      return { blocks: flashcards(body), facts: [], confidence };
    case 'concept_links':
      return { blocks: conceptLinks(body), facts: [], confidence };
    case 'audio_summary': {
      const cast = list(body.speakers).filter(isRecord).map((s) => `${str(s.role)} (${str(s.persona)})`);
      return { blocks: audioScript(body), facts: [...fact('Title', str(body.title)), ...fact('Cast', cast.join('; '))], confidence };
    }
    case 'salience_marks':
      return { blocks: salienceMarks(body), facts: [], confidence };
    case 'paper_card':
      return { blocks: paperCardBlocks(parsePaperCard(body)), facts: [], confidence };
    case 'paper_explainer':
      return { blocks: explainerBlocks(parseExplainer(body)), facts: [], confidence };
    case 'claim_set':
      return { blocks: claimSetBlocks(parseClaimSet(body)), facts: [], confidence };
    case 'results_table':
      return { blocks: resultsBlocks(parseResults(body)), facts: [], confidence };
    case 'citation_intents':
      return { blocks: intentsBlocks(parseIntents(body)), facts: [], confidence };
    case 'paper_assessment':
      return { blocks: assessmentBlocks(parseAssessment(body)), facts: [], confidence };
    case 'paper_review': {
      const review = parseReview(body);
      return { blocks: reviewBlocks(review), facts: [...fact('Recommendation', review.verdict.recommendation ? RECOMMENDATION_LABELS[review.verdict.recommendation] : '')], confidence };
    }
    case 'notation_table':
      return { blocks: notationBlocks(parseNotation(body)), facts: [], confidence };
    case 'journal_club':
      return { blocks: journalClubBlocks(parseJournalClub(body)), facts: [], confidence };
    case 'outline_override':
      return { blocks: outline(body), facts: [], confidence };
    case 'figure_description': {
      const takeaway = isRecord(body.takeaway) ? spans([body.takeaway]) : [];
      const tail: RenderBlock[] = takeaway.length ? [{ type: 'callout', tone: 'insight', title: 'Takeaway', spans: takeaway }] : [];
      return {
        blocks: [...blocks(body.blocks), ...tail],
        facts: [...fact('Kind', str(body.kind)), ...fact('Caption', str(body.caption)), ...fact('Alt text', str(body.alt))],
        confidence,
      };
    }
    default:
      return {
        blocks: blocks(body.blocks),
        facts: [...fact('Concepts', joined(body.concepts)), ...fact('Tags', joined(body.tags))],
        confidence,
      };
  }
}

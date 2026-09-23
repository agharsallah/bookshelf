/**
 * Client-side validation against the closed block set (contracts/render-blocks.schema.json).
 * It catches what a person can get wrong in the editor before the server's schema gate
 * does; the server remains the authority and its errors are shown too.
 */
import { BLOCK_TYPES, CALLOUT_TONES, type Span } from '../../../lib/contract';
import type { BlockList } from './model';

export const ANCHOR_PATTERN = /^[a-z]+[0-9]+(\/[a-z]+[0-9]+)*$/;
const MAX_CITES = 20;
const MAX_SPANS = 40;

export interface Problem {
  list: number;
  block: number;
  message: string;
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

function citeProblems(cites: unknown, where: string): string[] {
  if (!Array.isArray(cites)) return [`${where}: cites must be a list.`];
  const out: string[] = [];
  const bad = cites.filter((c) => typeof c !== 'string' || !ANCHOR_PATTERN.test(c));
  if (bad.length) out.push(`${where}: “${bad.map(String).join('”, “')}” is not an anchor.`);
  if (new Set(cites).size !== cites.length) out.push(`${where}: the same anchor is cited twice.`);
  if (cites.length > MAX_CITES) out.push(`${where}: at most ${MAX_CITES} cites.`);
  return out;
}

function spansProblems(spans: unknown, where: string): string[] {
  if (!Array.isArray(spans) || spans.length === 0) return [`${where} needs at least one span of text.`];
  if (spans.length > MAX_SPANS) return [`${where}: at most ${MAX_SPANS} spans.`];
  return spans.flatMap((raw, i) => {
    const span = raw as Partial<Span>;
    const label = spans.length > 1 ? `${where}, span ${i + 1}` : where;
    return [...(nonEmpty(span.text) ? [] : [`${label} is empty.`]), ...citeProblems(span.cites, label)];
  });
}

function itemsProblems(items: unknown, noun: string): string[] {
  if (!Array.isArray(items) || items.length === 0) return [`A ${noun} list needs at least one item.`];
  return items.flatMap((item, i) => spansProblems(item, `Item ${i + 1}`));
}

/** Problems with one block, phrased for the person editing it. */
export function blockProblems(raw: unknown): string[] {
  if (!isRecord(raw)) return ['Not a block.'];
  const type = raw.type;
  if (typeof type !== 'string' || !(BLOCK_TYPES as readonly string[]).includes(type)) {
    return [`“${String(type)}” is not one of the ${BLOCK_TYPES.length} block types.`];
  }
  switch (type) {
    case 'heading':
      return [
        ...([2, 3, 4].includes(raw.level as number) ? [] : ['Heading level must be 2, 3 or 4.']),
        ...(nonEmpty(raw.text) ? [] : ['The heading is empty.']),
      ];
    case 'paragraph':
      return spansProblems(raw.spans, 'The paragraph');
    case 'callout':
      return [
        ...((CALLOUT_TONES as readonly string[]).includes(raw.tone as string) ? [] : ['Pick a callout tone.']),
        ...spansProblems(raw.spans, 'The callout'),
      ];
    case 'definition':
      return [...(nonEmpty(raw.term) ? [] : ['The term is empty.']), ...spansProblems(raw.spans, 'The definition')];
    case 'bullets':
      return itemsProblems(raw.items, 'bullet');
    case 'steps':
      return itemsProblems(raw.items, 'step');
    case 'table': {
      const header = Array.isArray(raw.header) ? raw.header : [];
      const rows = Array.isArray(raw.rows) ? raw.rows : [];
      const out = header.length === 0 ? ['A table needs at least one column.'] : [];
      rows.forEach((row, r) => {
        if (!Array.isArray(row) || row.length !== header.length) out.push(`Row ${r + 1} does not have ${header.length} cells.`);
        else row.forEach((cell, c) => out.push(...spansProblems([cell], `Row ${r + 1}, column ${c + 1}`)));
      });
      return out;
    }
    case 'quote':
      return [
        ...(nonEmpty(raw.text) ? [] : ['The quote is empty.']),
        ...(raw.page === null || (Number.isInteger(raw.page) && (raw.page as number) >= 0) ? [] : ['The page must be a whole number or blank.']),
        ...citeProblems(raw.cites, 'The quote'),
      ];
    case 'code':
      return [...(nonEmpty(raw.text) ? [] : ['The listing is empty.']), ...citeProblems(raw.cites, 'The listing')];
    case 'math':
      return [
        ...(nonEmpty(raw.latex) ? [] : ['The formula is empty.']),
        ...(raw.meaning === undefined ? [] : spansProblems(raw.meaning, 'The meaning')),
        ...citeProblems(raw.cites, 'The formula'),
      ];
    case 'chart': {
      const x = isRecord(raw.x) && Array.isArray(raw.x.values) ? raw.x.values : null;
      const series = Array.isArray(raw.series) ? raw.series : [];
      const out = x ? [] : ['The chart needs x values.'];
      series.forEach((s, i) => {
        if (!isRecord(s) || !Array.isArray(s.values) || (x && s.values.length !== x.length)) {
          out.push(`Series ${i + 1} does not have one value per x value.`);
        }
      });
      return [...out, ...citeProblems(raw.cites, 'The chart')];
    }
    case 'diagram': {
      const nodes = Array.isArray(raw.nodes) ? raw.nodes.filter(isRecord) : [];
      const ids = new Set(nodes.map((n) => n.id));
      const edges = Array.isArray(raw.edges) ? raw.edges.filter(isRecord) : [];
      const dangling = edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
      return [
        ...(nodes.length ? [] : ['The diagram needs at least one node.']),
        ...(dangling.length ? [`${dangling.length} edge(s) point at a missing node.`] : []),
        ...citeProblems(raw.cites, 'The diagram'),
      ];
    }
    default:
      return [];
  }
}

export function validateLists(lists: readonly BlockList[]): Problem[] {
  return lists.flatMap((list, l) =>
    list.blocks.flatMap((block, b) => blockProblems(block).map((message) => ({ list: l, block: b, message }))),
  );
}

/** Parse the advanced raw-JSON editor's text; the body must be a JSON object. */
export function parseRawBody(text: string): { body: Json } | { error: string } {
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) ? { body: value } : { error: 'The body must be a JSON object.' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Not valid JSON.' };
  }
}

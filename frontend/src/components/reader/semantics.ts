/**
 * What a source block *is*, for the colour-coded reading mode: a quote, an
 * example, an exercise, a key point, a warning, a tip, a note, or a figure,
 * table, code listing or formula. Read from the block kind, an aside's label
 * (parse/text.py `aside_label`) and how a paragraph opens ("For example, …",
 * "Tip: …", a paragraph that is one quotation). Pure, so it runs per render.
 */
import type { NodeKind, NodeMeta } from '../../lib/api/types/documents';

/** Passages that get a tint and a label. */
export const PASSAGE_ROLES = ['quote', 'example', 'exercise', 'key', 'warning', 'tip', 'note'] as const;
/** Non-prose blocks that get a label only. */
export const MATTER_ROLES = ['code', 'figure', 'table', 'math'] as const;

export type PassageRole = (typeof PASSAGE_ROLES)[number];
export type SemanticRole = PassageRole | (typeof MATTER_ROLES)[number];

export const ROLE_LABELS: Record<SemanticRole, string> = {
  quote: 'Quote',
  example: 'Example',
  exercise: 'Exercise',
  key: 'Key point',
  warning: 'Warning',
  tip: 'Tip',
  note: 'Note',
  code: 'Code',
  figure: 'Figure',
  table: 'Table',
  math: 'Formula',
};

export interface BlockRole {
  role: SemanticRole;
  /** What to call it: the aside's own label when it has one ("Key takeaways"). */
  label: string;
}

/** A label word → role, most specific first. */
const LABEL_ROLES: readonly [RegExp, PassageRole][] = [
  [/\b(exercises?|problems?|try it|practice)\b/i, 'exercise'],
  [/\b(examples?|case study|for instance)\b/i, 'example'],
  [/\b(warning|caution|danger|pitfall)\b/i, 'warning'],
  [/\b(key|takeaways?|remember|important|summary)\b/i, 'key'],
  [/\b(tips?|hint)\b/i, 'tip'],
];

function roleForLabel(label: string): PassageRole {
  return LABEL_ROLES.find(([pattern]) => pattern.test(label))?.[1] ?? 'note';
}

/** "Tip: …", "Key point — …", "Example 3.2. …" at the start of a paragraph. */
const LEAD_LABEL =
  /^\s*(notes?|tips?|hint|warning|caution|important|remember|key (?:points?|takeaways?|ideas?)|takeaways?|exercises?|problems?|try it|examples?)(?:\s+\d+(?:\.\d+)*)?\s*[:.—–]/i;
const EXAMPLE_LEAD = /^\s*(for (?:example|instance)\b|e\.g\.)/i;
/** The whole paragraph is one quotation (a sample answer, an epigraph). */
const WHOLE_QUOTE = /^\s*[“"«„][\s\S]{12,}[”"»“](?:\s*[—–-][^“”"]{0,80})?\s*$/;

export function roleOf(node: { kind: NodeKind; text: string | null; meta: NodeMeta }): BlockRole | null {
  const text = node.text ?? '';
  const plain = (role: SemanticRole): BlockRole => ({ role, label: ROLE_LABELS[role] });
  switch (node.kind) {
    case 'quote':
      return plain('quote');
    case 'aside': {
      const label = node.meta.label?.trim();
      return label ? { role: roleForLabel(label), label } : plain('note');
    }
    case 'paragraph':
    case 'list': {
      const lead = LEAD_LABEL.exec(text);
      if (lead?.[1]) return plain(roleForLabel(lead[1]));
      if (EXAMPLE_LEAD.test(text)) return plain('example');
      if (node.kind === 'paragraph' && WHOLE_QUOTE.test(text)) return plain('quote');
      return null;
    }
    case 'code':
      // "Example 3.2" captions a worked example; "Listing 3.2" is just code.
      return plain(/^\s*example\b/i.test(node.meta.caption ?? '') ? 'example' : 'code');
    case 'figure':
    case 'table':
    case 'math':
      return plain(node.kind);
    default:
      return null;
  }
}

export function isPassage(role: SemanticRole): role is PassageRole {
  return (PASSAGE_ROLES as readonly string[]).includes(role);
}

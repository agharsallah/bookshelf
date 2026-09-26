/**
 * The book's vocabulary, for the "what matters" reading mode: every concept the
 * idea graph extracted (link-concepts) and every term the glossary defines, merged
 * by name into one list of phrases to find in the text. Built on the server from
 * the two book-level artifacts, so the reader ships a few kilobytes, not their bodies.
 */
import type { ArtifactPublic } from '../../lib/api/types/artifacts';
import { pickBest } from '../../lib/documents/artifacts';

export interface LexTerm {
  /** How to name it in the card: the glossary's spelling, else the concept's canonical name. */
  label: string;
  /** Lowercase spellings to look for in the text (canonical name and aliases), longest first. */
  forms: string[];
  /** Concept kind from the graph, or `term` for a glossary-only entry. */
  kind: string;
  /** A one-line definition or blurb, when the book gives one. */
  gloss: string | null;
  /** Blocks that define it (`defines` edges), where its first mention is best marked. */
  defines: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Joined text of a span list (`[{text, cites}]`), or null when there is none. */
function spansText(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const text = value
    .filter(isRecord)
    .map((span) => (typeof span.text === 'string' ? span.text.trim() : ''))
    .filter(Boolean)
    .join(' ');
  return text || null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

/** Anchors each concept is defined at: `defines` edges between a concept and a passage. */
function definitions(edges: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!Array.isArray(edges)) return out;
  for (const edge of edges.filter(isRecord)) {
    if (edge.relation !== 'defines' || !isRecord(edge.src) || !isRecord(edge.dst)) continue;
    const ends = [edge.src, edge.dst];
    const concept = ends.find((e) => e.kind === 'concept')?.ref;
    const node = ends.find((e) => e.kind === 'node')?.ref;
    if (typeof concept !== 'string') continue;
    const anchors = [...(typeof node === 'string' ? [node] : []), ...strings(edge.evidence)];
    out.set(concept.toLowerCase(), [...new Set([...(out.get(concept.toLowerCase()) ?? []), ...anchors])]);
  }
  return out;
}

/** Forms shorter than this are too ambiguous to mark ("AI" aside, most two-letter words are noise). */
const MIN_FORM = 3;

function forms(names: readonly string[]): string[] {
  const all = names.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= MIN_FORM);
  return [...new Set(all)].sort((a, b) => b.length - a.length);
}

/** The lexicon from a `concept_links` body and a `glossary` body; either may be missing. */
export function lexiconFrom(conceptLinks: Record<string, unknown> | null, glossary: Record<string, unknown> | null): LexTerm[] {
  const byName = new Map<string, LexTerm>();
  const defined = definitions(conceptLinks?.edges);

  const concepts = Array.isArray(conceptLinks?.concepts) ? conceptLinks.concepts.filter(isRecord) : [];
  for (const concept of concepts) {
    if (typeof concept.canonical !== 'string' || !concept.canonical.trim()) continue;
    const key = concept.canonical.trim().toLowerCase();
    byName.set(key, {
      label: concept.canonical.trim(),
      forms: forms([concept.canonical, ...strings(concept.aliases)]),
      kind: typeof concept.kind === 'string' ? concept.kind : 'concept',
      gloss: spansText(concept.blurb),
      defines: defined.get(key) ?? [],
    });
  }

  const blocks = Array.isArray(glossary?.blocks) ? glossary.blocks.filter(isRecord) : [];
  for (const block of blocks) {
    if (block.type !== 'definition' || typeof block.term !== 'string' || !block.term.trim()) continue;
    const key = block.term.trim().toLowerCase();
    const gloss = spansText(block.spans);
    const known = byName.get(key);
    if (known) {
      // The glossary spells terms as the book does ("Kingman's formula") and defines them fully.
      byName.set(key, { ...known, label: block.term.trim(), gloss: gloss ?? known.gloss });
    } else {
      byName.set(key, { label: block.term.trim(), forms: forms([block.term]), kind: 'term', gloss, defines: [] });
    }
  }

  return [...byName.values()].filter((t) => t.forms.length > 0);
}

/** The lexicon from a book's artifacts: the best `concept_links` and `glossary` bodies. */
export function lexiconFromArtifacts(artifacts: readonly ArtifactPublic[]): LexTerm[] {
  const body = (type: 'concept_links' | 'glossary') => pickBest(artifacts, type, null)?.artifact.body ?? null;
  return lexiconFrom(body('concept_links'), body('glossary'));
}

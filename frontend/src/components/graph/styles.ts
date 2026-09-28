/**
 * The graph's visual vocabulary, shared by the canvas, the legend and the list view.
 *
 * Kinds are told apart by shape first and colour second (series tokens 1–4, a
 * CVD-validated order): a concept is an open ring set in italic, a passage a small
 * square like a pilcrow, a document a book spine, an artifact a diamond.
 * Relations are told apart by their terminal mark and line pattern, colour third; a
 * proposed edge of any relation is dashed.
 *
 * A paper's vocabulary (method, dataset, metric, task) stays a ring, so it still reads as
 * a concept, but takes its own series colour and a glyph inside the ring. The glyph is the
 * primary cue: no four of our six series tokens stay apart for deuteranopes (4↔6 and 2↔4
 * fall under ΔE 5 in both themes, 4↔5 under the normal-vision floor), so colour only
 * reinforces it. The assignment keeps the pairs that do pass (1↔any, 2↔5, 5↔6) on the
 * generic concept and on dataset, the kind most often seen next to methods and metrics.
 * The claim diamond shares --series-6 with metric rings; the shape tells them apart.
 */
import {
  DERIVED_LINKS,
  RELATIONS,
  type AtlasRelation,
  type ConceptKind,
  type EntityKind,
  type Relation,
} from '../../lib/api/types/graph';

export type Shape = 'ring' | 'square' | 'spine' | 'diamond';
export type Terminal = 'arrow' | 'bar' | 'dot' | 'tick' | 'none' | 'equals';

export interface KindStyle {
  label: string;
  plural: string;
  shape: Shape;
  /** CSS custom property holding the colour. */
  color: string;
  /** Base radius in world units; hit targets add slop on top. */
  radius: number;
}

export const KIND_STYLES: Record<EntityKind, KindStyle> = {
  concept: { label: 'Concept', plural: 'Concepts', shape: 'ring', color: '--series-1', radius: 7 },
  node: { label: 'Passage', plural: 'Passages', shape: 'square', color: '--series-2', radius: 5 },
  document: { label: 'Book', plural: 'Books', shape: 'spine', color: '--series-3', radius: 8 },
  artifact: { label: 'Artifact', plural: 'Artifacts', shape: 'diamond', color: '--series-4', radius: 6 },
  claim: { label: 'Claim', plural: 'Claims', shape: 'diamond', color: '--series-6', radius: 5 },
};

/** The mark inside a concept's ring; `none` for the kinds books use. */
export type ConceptGlyph = 'none' | 'dot' | 'rows' | 'tick' | 'plus';

export interface ConceptKindStyle {
  label: string;
  plural: string;
  color: string;
  glyph: ConceptGlyph;
}

const GENERIC = { color: '--series-1', glyph: 'none' } as const;

export const CONCEPT_KIND_STYLES: Record<ConceptKind, ConceptKindStyle> = {
  concept: { label: 'Concept', plural: 'Concepts', ...GENERIC },
  framework: { label: 'Framework', plural: 'Frameworks', ...GENERIC },
  person: { label: 'Person', plural: 'People', ...GENERIC },
  work: { label: 'Work', plural: 'Works', ...GENERIC },
  term: { label: 'Term', plural: 'Terms', ...GENERIC },
  method: { label: 'Method', plural: 'Methods', color: '--series-4', glyph: 'dot' },
  dataset: { label: 'Dataset', plural: 'Datasets', color: '--series-5', glyph: 'rows' },
  metric: { label: 'Metric', plural: 'Metrics', color: '--series-6', glyph: 'tick' },
  task: { label: 'Task', plural: 'Tasks', color: '--series-2', glyph: 'plus' },
};

/** The concept kinds with a mark of their own (a paper's vocabulary), in legend order. */
export const MARKED_CONCEPT_KINDS = (Object.keys(CONCEPT_KIND_STYLES) as ConceptKind[]).filter((k) => CONCEPT_KIND_STYLES[k].glyph !== 'none');

/** A concept kind from a wire value (a neighbourhood concept's sublabel is its kind). */
export function conceptKindOf(value: string | null | undefined): ConceptKind | undefined {
  return value && value in CONCEPT_KIND_STYLES ? (value as ConceptKind) : undefined;
}

export interface RelationStyle {
  label: string;
  /** How the edge reads, source → target. */
  verb: string;
  color: string;
  /** Canvas dash pattern in screen px; empty is solid. */
  dash: number[];
  terminal: Terminal;
}

export const RELATION_STYLES: Record<Relation, RelationStyle> = {
  supports: { label: 'Supports', verb: 'supports', color: '--accent', dash: [], terminal: 'arrow' },
  contradicts: { label: 'Contradicts', verb: 'contradicts', color: '--tone-important', dash: [], terminal: 'bar' },
  extends: { label: 'Extends', verb: 'extends', color: '--tone-remember', dash: [], terminal: 'arrow' },
  example_of: { label: 'Example of', verb: 'is an example of', color: '--tone-insight', dash: [1, 3], terminal: 'dot' },
  defines: { label: 'Defines', verb: 'defines', color: '--tone-caution', dash: [], terminal: 'tick' },
  mentions: { label: 'Mentions', verb: 'mentions', color: '--ink-3', dash: [], terminal: 'none' },
  same_as: { label: 'Same as', verb: 'is the same as', color: '--ink-2', dash: [], terminal: 'equals' },
  echoes: { label: 'Echoes', verb: 'echoes', color: '--series-5', dash: [4, 3], terminal: 'none' },
  cites: { label: 'Cites', verb: 'cites', color: '--ink-3', dash: [], terminal: 'arrow' },
};

/** Every line the canvas can draw: the stored relations and the atlas's derived ones. */
export type LinkKind = AtlasRelation;
export const LINK_KINDS: readonly LinkKind[] = [...RELATIONS, ...DERIVED_LINKS];

export const LINK_STYLES: Record<LinkKind, RelationStyle> = {
  ...RELATION_STYLES,
  contains: { label: 'Contains', verb: 'contains', color: '--rule-strong', dash: [], terminal: 'none' },
  shares: { label: 'Shares ideas', verb: 'shares ideas with', color: '--series-2', dash: [2, 4], terminal: 'none' },
};

export const PROPOSED_DASH = [6, 4];

/** Screen line width for an edge: 1–3.5px, by weight × evidence relative to the strongest. */
export function edgeWidth(strength: number, strongest: number): number {
  if (strongest <= 0) return 1;
  return 1 + 2.5 * Math.sqrt(Math.min(1, Math.max(0, strength / strongest)));
}

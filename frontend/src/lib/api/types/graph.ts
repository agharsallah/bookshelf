/**
 * Idea-graph wire shapes (backend/app/schemas/graph.py): concepts, edges, evidence
 * passages and neighborhoods.
 *
 * Every endpoint id is one string, `<kind>:<id>`: `concept:<uuid>`, `document:<uuid>`,
 * `artifact:<uuid>` or `node:<document_id>#<anchor>`, accepted back as `?node=`.
 * Evidence refs are qualified anchors, `<document_id>#<anchor>`.
 */
import type { Origin } from './artifacts';

export const CONCEPT_KINDS = ['concept', 'framework', 'person', 'work', 'term'] as const;
export type ConceptKind = (typeof CONCEPT_KINDS)[number];

export const ENTITY_KINDS = ['concept', 'node', 'document', 'artifact'] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

export const RELATIONS = [
  'supports',
  'contradicts',
  'extends',
  'example_of',
  'defines',
  'mentions',
  'same_as',
] as const;
export type Relation = (typeof RELATIONS)[number];

export const EDGE_STATUSES = ['proposed', 'accepted', 'rejected'] as const;
export type EdgeStatus = (typeof EDGE_STATUSES)[number];

/** `concept:<id>`, `node:<document_id>#<anchor>`, `document:<id>`, `artifact:<id>`. */
export type GraphRef = string;

export interface GraphDocument {
  id: string;
  slug: string;
  title: string;
}

/** One evidence passage, resolvable in the reader as `{document.slug, anchor}`. */
export interface Passage {
  ref: string;
  document: GraphDocument | null;
  anchor: string;
  kind: string | null;
  /** Nearest heading at or above the anchor. */
  heading: string | null;
  snippet: string | null;
  /** False when the anchor vanished on a re-parse. */
  exists: boolean;
}

export interface ConceptSummary {
  id: string;
  canonical: string;
  aliases: string[];
  kind: ConceptKind;
  blurb: string | null;
  merged_into: string | null;
  /** `human` once a person created or edited it. */
  origin: Origin;
}

export interface ConceptPublic extends ConceptSummary {
  blurb_cites: string[];
  created_at: string;
}

/** `PATCH /concepts/{id}`: omitted fields stay; `blurb: null` clears it. */
export interface ConceptUpdate {
  canonical?: string;
  kind?: ConceptKind;
  aliases?: string[];
  blurb?: string | null;
  blurb_cites?: string[];
}

/** `POST /concepts/{id}/merge`: the path concept is merged into `into`. */
export interface MergeRequest {
  into: string;
}

export interface GraphNode {
  id: GraphRef;
  kind: EntityKind;
  label: string;
  sublabel?: string | null;
  document?: GraphDocument | null;
  anchor?: string | null;
  blurb?: string | null;
  /** Ring: 0 is the focus. */
  depth: number;
  /** Best edge score into the previous ring. */
  weight: number;
  /** Neighbors left out of this response. */
  more: number;
}

export interface GraphEdge {
  id: string;
  src: GraphRef;
  dst: GraphRef;
  relation: Relation;
  weight: number;
  evidence_count: number;
  status: EdgeStatus;
  origin: string;
  /** Underlying edges; several when a document focus folds passages. */
  edge_ids: string[];
}

export interface Neighborhood {
  focus: GraphRef;
  depth: number;
  nodes: GraphNode[];
  /** Ranked by weight × evidence count. */
  edges: GraphEdge[];
  /** The server's node cap (150) cut the neighborhood. */
  truncated: boolean;
}

export interface ConceptEdge {
  id: string;
  relation: Relation;
  direction: 'out' | 'in';
  other: GraphNode;
  weight: number;
  status: EdgeStatus;
  origin: string;
  evidence: Passage[];
}

export interface RelationGroup {
  relation: Relation;
  edges: ConceptEdge[];
}

export interface ConceptDetail {
  concept: ConceptPublic;
  blurb_passages: Passage[];
  /** Accepted and proposed edges, strongest first. */
  relations: RelationGroup[];
}

/** `PATCH /edges/{id}`. */
export interface EdgeUpdate {
  status: EdgeStatus;
}

export interface EdgeDetail {
  id: string;
  src: GraphNode;
  dst: GraphNode;
  relation: Relation;
  weight: number;
  status: EdgeStatus;
  origin: string;
  evidence: Passage[];
  created_at: string;
}

/** A proposed `same_as`, waiting for a human to merge one side into the other. */
export interface MergeProposal {
  edge_id: string;
  a: ConceptSummary;
  b: ConceptSummary;
  /** Embedding cosine (dedup only). */
  similarity: number | null;
  confidence: string | null;
  /** The model's reason (dedup only). */
  rationale: string | null;
  suggested_survivor: string | null;
  origin: string;
  evidence: Passage[];
  created_at: string;
}

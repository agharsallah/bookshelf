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
  /** Two chapters whose passages say similar things (embedding similarity). */
  'echoes',
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
  /** Accepted edges, with the concepts merged into it folded in (lists only). */
  edge_count?: number;
}

/** `GET /concepts?sort=`: by name, most edges, or newest. */
export const CONCEPT_SORTS = ['alpha', 'connected', 'recent'] as const;
export type ConceptSort = (typeof CONCEPT_SORTS)[number];

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
  /** Why a skill proposed it (bridges, dedup). */
  rationale?: string | null;
  confidence?: string | null;
}

/** `POST /graph/bridges`: bridge jobs queued, one per book. */
export interface BridgeQueued {
  jobs: string[];
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

// --- The atlas: the whole shelf at chapter grain (`GET /graph/atlas`) --------------------

export const ATLAS_KINDS = ['document', 'chapter', 'concept'] as const;
export type AtlasKind = (typeof ATLAS_KINDS)[number];

/** Lines the atlas derives: a book's chapters, and chapters that lean on the same concepts. */
export const DERIVED_LINKS = ['contains', 'shares'] as const;
export type DerivedLink = (typeof DERIVED_LINKS)[number];
export type AtlasRelation = Relation | DerivedLink;

export interface AtlasNode {
  /** `document:<id>`, `concept:<id>`, or `node:<document_id>#<chapter anchor>`. */
  id: GraphRef;
  kind: AtlasKind;
  label: string;
  sublabel: string | null;
  document: GraphDocument | null;
  /** A chapter's anchor, for the reader. */
  anchor: string | null;
  blurb: string | null;
  concept_kind: ConceptKind | null;
  /** Reading order within the book. */
  ordinal: number;
  /** Lines touching it in this atlas. */
  degree: number;
  /** Books it appears in. */
  books: number;
  /** Evidence passages behind it. */
  passages: number;
}

export interface AtlasEdge {
  id: string;
  src: GraphRef;
  dst: GraphRef;
  relation: AtlasRelation;
  weight: number;
  evidence_count: number;
  status: EdgeStatus;
  /** Stored edges folded into this line (none for derived lines). */
  edge_ids: string[];
  /** A few qualified anchors to open. */
  evidence: string[];
  /** `shares` only: the concepts the two chapters have in common. */
  concepts: GraphRef[];
}

export interface Atlas {
  nodes: AtlasNode[];
  /** Ranked by weight × evidence count. */
  edges: AtlasEdge[];
  /** The concept or chapter budget cut the map. */
  truncated: boolean;
}

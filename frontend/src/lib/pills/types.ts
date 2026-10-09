/**
 * TypeScript mirror of the pill contract (`contracts/pill.schema.json`, docs/PILLS.md §2)
 * and the shapes of the pills API (§7). Framework-free on purpose: `lib/pills` may move
 * into a shared package for a mobile client, so nothing here imports React, the DOM or
 * Astro. Spans, cites and diagram blocks are the render contract's.
 *
 * The kind set is closed: adding a kind changes the schema, the backend and the
 * renderers (`components/pills/kinds`) in the same commit.
 */
import type { Anchor, DiagramBlock, Spans } from '../contract';

export type { Anchor, Spans };

export const PILL_KINDS = [
  'insight',
  'remember',
  'antipattern',
  'quote',
  'definition',
  'number',
  'figure',
  'diagram',
  'quiz',
  'flip',
  'claim',
  'math',
  'connection',
  'listen',
  'hook',
  'review',
] as const;
export type PillKind = (typeof PILL_KINDS)[number];

export type PillGenre = 'book' | 'paper' | 'article';

/** The document a pill rests on, as much as a source chip needs. */
export interface PillDocument {
  id: string;
  slug: string;
  title: string;
  genre: PillGenre;
  /** The catalogue theme it is shelved under, or null. */
  theme: string | null;
}

export type DocumentRef = Pick<PillDocument, 'id' | 'slug' | 'title'>;

/** Where one cite points: needed when it is cross-document (`<slug>:<anchor>`). */
export interface PillSource {
  document: DocumentRef;
  anchor: Anchor;
}

export interface PillThread {
  key: string;
  index: number;
  size: number;
  title: string | null;
}

// ---- Kind bodies (§2 table) -------------------------------------------------------------

export interface InsightBody {
  spans: Spans;
  why?: Spans;
}
export interface SpansBody {
  spans: Spans;
}
export interface QuoteBody {
  text: string;
  page?: number | null;
  attribution?: string | null;
}
export interface DefinitionBody {
  term: string;
  spans: Spans;
}
export interface NumberBody {
  value: string;
  label: Spans;
}
export interface FigureBody {
  /** Relative to the API base, e.g. `media/<image_path>` (`mediaUrl`). */
  image_url: string;
  caption?: string | null;
  takeaway: Spans;
}
export interface DiagramBody {
  diagram: DiagramBlock;
  caption?: string | null;
}
export interface QuizBody {
  question: string;
  choices: string[];
  /** Index into `choices`. */
  answer: number;
  explanation: Spans;
}
export interface FlipBody {
  front: string;
  back: Spans;
}
export type ClaimKind = 'method' | 'result' | 'theory' | 'dataset' | 'benchmark' | 'position';
export type ClaimStrength = 'measured' | 'argued' | 'speculated';
export interface ClaimBody {
  text: string;
  claim_kind: ClaimKind;
  strength: ClaimStrength;
  /** How many accepted claim edges support, contradict or extend it. */
  support: { supports: number; contradicts: number; extends: number };
}
export interface MathBody {
  latex: string;
  name: string;
  plain: Spans;
  try_it?: { question: string; answer: Spans } | null;
}
export interface ConnectionSide {
  document: DocumentRef;
  anchor: Anchor;
  spans: Spans;
}
export type ConnectionRelation = 'echoes' | 'supports' | 'contradicts' | 'extends' | 'example_of' | 'same_as';
export interface ConnectionBody {
  relation: ConnectionRelation;
  concept?: string | null;
  sides: [ConnectionSide, ConnectionSide];
}
export interface ListenBody {
  /** Relative to the API base, e.g. `audio/files/<doc>/<source>/<key>.mp3` (`mediaUrl`). */
  audio_url: string;
  start_ms: number;
  end_ms: number;
  transcript: Spans;
}
export interface HookBody {
  spans: Spans;
  payoff: Spans;
}
export interface ReviewBody {
  prompt: string;
  answer: Spans;
}

export interface PillBodies {
  insight: InsightBody;
  remember: SpansBody;
  antipattern: SpansBody;
  quote: QuoteBody;
  definition: DefinitionBody;
  number: NumberBody;
  figure: FigureBody;
  diagram: DiagramBody;
  quiz: QuizBody;
  flip: FlipBody;
  claim: ClaimBody;
  math: MathBody;
  connection: ConnectionBody;
  listen: ListenBody;
  hook: HookBody;
  review: ReviewBody;
}

interface PillBase {
  id: string;
  document: PillDocument;
  /** The unit (chapter or section) the pill belongs to. */
  anchor: Anchor;
  unit_title: string | null;
  /** A short hook line (≤ 80 chars), or null. */
  headline: string | null;
  /**
   * Every anchor the pill rests on: bare in the pill's own document, `<slug>:<anchor>` in
   * another (`sources` resolves each). Span cites inside a body are bare anchors of the
   * pill's document, except a connection side's, which belong to that side's document.
   */
  cites: string[];
  sources: Record<string, PillSource>;
  concepts: string[];
  thread: PillThread | null;
  est_seconds: number;
  /** `harvest:<artifact_type>`, `skill:make-pills@<v>` or `review:<source>`. */
  origin: string;
  /** The source artifact is not yet approved. */
  draft: boolean;
  /** Set on `review` pills. */
  review_item_id: string | null;
}

/** One pill of kind `K`: its body follows the kind. */
export type PillOf<K extends PillKind> = PillBase & { kind: K; body: PillBodies[K] };

/** Any pill, discriminated on `kind`. */
export type Pill = { [K in PillKind]: PillOf<K> }[PillKind];

/** Kinds that ask something of the reader (§2). `math` is active only with `try_it`. */
export const ACTIVE_KINDS: readonly PillKind[] = ['quiz', 'flip', 'review'];

export function isActive(pill: Pill): boolean {
  return ACTIVE_KINDS.includes(pill.kind) || (pill.kind === 'math' && Boolean(pill.body.try_it));
}

// ---- Feed config (§6) -------------------------------------------------------------------

export const FEED_MODES = ['consolidate', 'preview', 'explore', 'review'] as const;
export type FeedMode = (typeof FEED_MODES)[number];

export const FEED_LENGTHS = [10, 20, 40] as const;
/** Pills per session; null is endless. */
export type FeedLength = (typeof FEED_LENGTHS)[number] | null;

/**
 * What a feed draws from. All empty means the whole shelf. Documents and collections
 * may be named by id or slug; paper sets and concepts by id.
 */
export interface FeedSources {
  documents: string[];
  collections: string[];
  paper_sets: string[];
  concepts: string[];
  genre: PillGenre | null;
}

export interface FeedConfig {
  sources: FeedSources;
  mode: FeedMode;
  /** null = every kind. */
  kinds: PillKind[] | null;
  length: FeedLength;
  spoilers: boolean;
}

// ---- Sessions, pages and summaries ------------------------------------------------------

export interface PillSession {
  id: string;
  config: FeedConfig;
  seed: number;
  position: number;
  created_at: string;
  finished_at: string | null;
}

/** A chapter `make-pills` could still run on, with what one run is expected to cost. */
export interface Generatable {
  anchor: Anchor;
  title: string | null;
  /** Average tokens of one past make-pills job; null without history. */
  estimate_tokens: number | null;
}

export interface SupplyDocument {
  document: DocumentRef;
  unseen: number;
  /** Chapters with a chapter distillation and no `pill_set` yet. */
  generatable: Generatable[];
  /** No distillation yet, so no pills can be made. */
  undistilled: boolean;
}

export interface Supply {
  unseen: number;
  by_document: SupplyDocument[];
  /** Under the low-water mark (30 unseen). */
  low: boolean;
}

export interface SessionPage {
  pills: Pill[];
  /** Opaque; null when nothing more is to be served. */
  next_cursor: string | null;
}

/** `POST /pills/sessions`. */
export interface SessionStart {
  session: PillSession;
  page: SessionPage;
  supply: Supply;
  /** Why the feed differs from what was asked (`nothing read yet`), when it does. */
  notice?: string | null;
}

/** `GET /pills/sessions/{id}`. */
export interface SessionContinuation extends SessionPage {
  supply: Supply;
  /** The session's length is reached, or the scope ran dry. */
  done: boolean;
  notice?: string | null;
}

/** Where to pick up reading after a session. */
export interface NextRead {
  document: DocumentRef;
  anchor: Anchor;
  title?: string | null;
}

export interface SessionSummary {
  seen: number;
  saved: number;
  answered: number;
  correct: number;
  due_tomorrow: number;
  minutes: number;
  next_read?: NextRead | null;
}

export type StartRequest = { config: FeedConfig } | { feed_id: string };

// ---- Events -----------------------------------------------------------------------------

export const PILL_EVENT_KINDS = ['seen', 'dwell', 'answer', 'save', 'unsave', 'skip', 'too_easy', 'confusing', 'open_source'] as const;
export type PillEventKind = (typeof PILL_EVENT_KINDS)[number];

/** dwell: `{ms}`; answer: `{correct, choice?}` (review pills add the `rating`). */
export type PillEventValue = Record<string, unknown>;

export interface PillEvent {
  /** Client-generated: a retried event is a no-op on the server. */
  id: string;
  session_id?: string | null;
  pill_id?: string | null;
  review_item_id?: string | null;
  kind: PillEventKind;
  value?: PillEventValue | null;
  /** ISO 8601. */
  at: string;
}

export interface EventsResult {
  accepted: number;
  /** Ids already recorded (retries): no-ops. */
  duplicates: number;
  /** Events on a pill or review item that no longer exists (dropped, never an error). */
  ignored: number;
}

/** The most events one `POST /pills/events` takes. */
export const MAX_EVENT_BATCH = 200;

// ---- Generation, rebuilds and saved feeds -----------------------------------------------

export type PillStyle = 'plain' | 'story' | 'socratic';

export interface GenerateRequest {
  /** Document id or slug. */
  document: string;
  anchors?: Anchor[];
  style?: PillStyle;
}

export interface GenerateResult {
  jobs: string[];
  /** Expected tokens for all the queued jobs; null without history. */
  estimate_tokens: number | null;
}

export interface RebuildResult {
  jobs: string[];
}

export interface Feed {
  id: string;
  name: string;
  config: FeedConfig;
  created_at: string;
  updated_at: string;
}

/** `GET /pills/feeds`. */
export interface FeedList {
  items: Feed[];
}

export interface FeedCreate {
  name: string;
  config: FeedConfig;
}

export type FeedPatch = Partial<FeedCreate>;

/** A body's media path (relative to the API base) as a URL under `baseUrl`. */
export function mediaUrl(baseUrl: string, path: string): string {
  if (/^(https?:|data:|blob:)/.test(path) || path.startsWith('/')) return path;
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

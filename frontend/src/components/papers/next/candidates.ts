/**
 * The reading queue's pure logic (`/papers/next`): filters in the URL, how a candidate was
 * found (source chips naming the shelf paper that led to it), the cites of its reason
 * (`<document_id>#<anchor>`, opened in that paper's reader), and which status moves fit
 * each state, with the undo that puts a dismissed paper back.
 */
import { anchorLabel } from '../../../lib/anchors';
import {
  CANDIDATE_SOURCES,
  CANDIDATE_STATUSES,
  type CandidateSource,
  type CandidateStatus,
  type ReadingCandidatePublic,
} from '../../../lib/api/types/papers';

export const SOURCE_LABELS: Record<CandidateSource, { name: string; hint: string }> = {
  reference: { name: 'Reference', hint: 'In the bibliography of a paper on your shelf.' },
  cited_by: { name: 'Cited by', hint: 'A newer paper that cites one on your shelf.' },
  related: { name: 'Related', hint: 'OpenAlex lists it as related to a paper on your shelf.' },
  similar: { name: 'Similar', hint: 'Its abstract reads like papers you rated 4 stars or more.' },
  watch: { name: 'Watch', hint: 'New: it cites a paper you watch (rated 4 stars or more).' },
};

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  suggested: 'Suggested',
  queued: 'Queued',
  dismissed: 'Dismissed',
  ingested: 'On the shelf',
};

// ── Filters ─────────────────────────────────────────────────────────────────────────

/** `live` = suggested and queued (the API's default). */
export type StatusFilter = 'live' | CandidateStatus;
export const STATUS_FILTERS: readonly StatusFilter[] = ['live', ...CANDIDATE_STATUSES];

export interface NextFilters {
  status: StatusFilter;
  source: CandidateSource | null;
}

export const DEFAULT_FILTERS: NextFilters = { status: 'live', source: null };

export function parseNextFilters(params: URLSearchParams): NextFilters {
  const status = params.get('status');
  const source = params.get('source');
  return {
    status: STATUS_FILTERS.includes(status as StatusFilter) ? (status as StatusFilter) : 'live',
    source: CANDIDATE_SOURCES.includes(source as CandidateSource) ? (source as CandidateSource) : null,
  };
}

export function nextHref(filters: NextFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== 'live') params.set('status', filters.status);
  if (filters.source) params.set('source', filters.source);
  const qs = params.toString();
  return `/papers/next${qs ? `?${qs}` : ''}`;
}

/** The `GET /papers/candidates` query; the source is filtered here (the API has no such key). */
export function candidatesQuery(filters: NextFilters): { status?: CandidateStatus; limit: number } {
  return filters.status === 'live' ? { limit: 100 } : { status: filters.status, limit: 100 };
}

export function bySource<T extends Pick<ReadingCandidatePublic, 'sources'>>(items: readonly T[], source: CandidateSource | null): T[] {
  return source ? items.filter((c) => c.sources.some((s) => s.kind === source)) : [...items];
}

// ── Sources and cites ───────────────────────────────────────────────────────────────

/** What the page knows of shelf papers, by document id. */
export type ShelfIndex = Readonly<Record<string, { slug: string; title: string }>>;

export interface SourceChip {
  kind: CandidateSource;
  name: string;
  hint: string;
  /** The shelf papers that led to it this way, by title. */
  via: string[];
}

/** One chip per kind, in vocabulary order, naming the shelf papers behind it. */
export function sourceChips(sources: ReadingCandidatePublic['sources'], shelf: ShelfIndex): SourceChip[] {
  return CANDIDATE_SOURCES.flatMap((kind) => {
    const mine = sources.filter((s) => s.kind === kind);
    if (mine.length === 0) return [];
    const via = [...new Set(mine.flatMap((s) => (s.document_id && shelf[s.document_id] ? [shelf[s.document_id]?.title ?? ''] : [])))];
    return [{ kind, ...SOURCE_LABELS[kind], via }];
  });
}

export interface ReasonCite {
  cite: string;
  /** The reader at that passage; null when the paper is not on the shelf any more. */
  href: string | null;
  /** `§3 ¶2`-style place. */
  label: string;
  /** "Mixture of Experts, ch03/p002". */
  title: string;
}

/** Resolve `<document_id>#<anchor>` cites against the shelf, in the order given, once each. */
export function reasonCites(cites: readonly string[], shelf: ShelfIndex): ReasonCite[] {
  return [...new Set(cites)].map((cite) => {
    const at = cite.indexOf('#');
    const [doc, anchor] = at === -1 ? ['', cite] : [cite.slice(0, at), cite.slice(at + 1)];
    const paper = shelf[doc];
    return {
      cite,
      href: paper ? `/documents/${encodeURIComponent(paper.slug)}/read/${anchor}` : null,
      label: anchorLabel(anchor),
      title: paper ? `${paper.title}, ${anchor}` : anchor,
    };
  });
}

// ── Status moves ────────────────────────────────────────────────────────────────────

export type CandidateMove = 'queue' | 'unqueue' | 'dismiss' | 'restore';

const MOVE_TO: Record<CandidateMove, Exclude<CandidateStatus, 'ingested'>> = {
  queue: 'queued',
  unqueue: 'suggested',
  dismiss: 'dismissed',
  restore: 'suggested',
};

/** Which moves a status allows; an ingested paper is on the shelf and moves no more. */
export function movesFor(status: CandidateStatus): CandidateMove[] {
  switch (status) {
    case 'suggested':
      return ['queue', 'dismiss'];
    case 'queued':
      return ['unqueue', 'dismiss'];
    case 'dismissed':
      return ['restore'];
    case 'ingested':
      return [];
  }
}

/** The status a move asks for, or null when the move does not fit. */
export function moveTarget(status: CandidateStatus, move: CandidateMove): Exclude<CandidateStatus, 'ingested'> | null {
  return movesFor(status).includes(move) ? MOVE_TO[move] : null;
}

/** Undo of a dismissal: back to what it was before (queued stays queued). */
export function undoTarget(before: CandidateStatus): Exclude<CandidateStatus, 'ingested'> | null {
  return before === 'ingested' ? null : before;
}

/** Whether the PDF can be fetched (arXiv or an open-access link). */
export function canIngest(c: Pick<ReadingCandidatePublic, 'arxiv_id' | 'pdf_url' | 'status'>): boolean {
  return c.status !== 'ingested' && Boolean(c.arxiv_id || c.pdf_url);
}

/** The document a finished `paper_fetch` job made, from its result. */
export function fetchedDocument(result: Record<string, unknown> | null | undefined): string | null {
  const id = result?.document_id;
  return typeof id === 'string' && id ? id : null;
}

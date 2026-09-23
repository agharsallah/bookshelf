/**
 * Review-queue calls, all through an injected `ApiClient` (`browserApi` in islands,
 * `serverApi()` in page frontmatter) so components stay testable with a fake client.
 */
import type { ApiClient } from '../../lib/api/client';
import type { Page } from '../../lib/api/types';
import type {
  ArtifactCreate,
  ArtifactListItem,
  ArtifactPublic,
  Review,
  ReviewRequest,
} from '../../lib/api/types/artifacts';
import type { JobAccepted, JobKind } from '../../lib/api/types/jobs';
import { latestPerScope } from './queue';

/** A source block as `GET /documents/{ref}/blocks` returns it (NodePublic). */
export interface SourceBlock {
  id: string;
  anchor: string;
  kind: string;
  heading: string | null;
  text: string | null;
  page_from: number | null;
  page_to: number | null;
  meta: Record<string, unknown>;
}

/** A document as far as the review surfaces need it. */
export interface DocumentLabel {
  id: string;
  slug: string;
  title: string;
  status?: string;
}

const PAGE = 100;

async function allPages<T>(fetchPage: (offset: number) => Promise<Page<T>>, maxItems: number): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; offset < maxItems; offset += PAGE) {
    const page = await fetchPage(offset);
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) break;
  }
  return items;
}

/** Everything still waiting for a human: `needs_review` and `draft`, newest first per state. */
export async function loadQueue(api: ApiClient, maxPerState = 500): Promise<ArtifactListItem[]> {
  const states: Review[] = ['needs_review', 'draft'];
  const lists = await Promise.all(
    states.map((review) =>
      allPages(
        (offset) => api.get<Page<ArtifactListItem>>('artifacts', { query: { review, limit: PAGE, offset } }),
        maxPerState,
      ),
    ),
  );
  return latestPerScope(lists.flat());
}

export async function loadDocuments(api: ApiClient): Promise<DocumentLabel[]> {
  return allPages((offset) => api.get<Page<DocumentLabel>>('documents', { query: { limit: PAGE, offset } }), 500);
}

export function reviewArtifact(api: ApiClient, id: string, request: ReviewRequest): Promise<ArtifactPublic> {
  return api.post<ArtifactPublic>(`artifacts/${id}/review`, request);
}

export function listVersions(api: ApiClient, id: string): Promise<ArtifactPublic[]> {
  return api.get<ArtifactPublic[]>(`artifacts/${id}/versions`);
}

export function createArtifact(api: ApiClient, payload: ArtifactCreate): Promise<ArtifactPublic> {
  return api.post<ArtifactPublic>('artifacts', payload);
}

/** Regenerate one scope: the producing job, forced past the idempotency skip. */
export function rerun(api: ApiClient, kind: JobKind, artifact: Pick<ArtifactPublic, 'document_id' | 'anchor'>): Promise<JobAccepted> {
  return api.post<JobAccepted>('jobs', { kind, document_id: artifact.document_id, anchor: artifact.anchor, force: true });
}

/** Leaf blocks under an anchor (segment-aware prefix: `ch03` never matches `ch030`). */
export async function blocksUnder(api: ApiClient, documentId: string, anchor: string | null, maxItems = 300): Promise<SourceBlock[]> {
  return allPages(
    (offset) =>
      api.get<Page<SourceBlock>>(`documents/${documentId}/blocks`, {
        query: { anchor_prefix: anchor ?? undefined, limit: PAGE, offset },
      }),
    maxItems,
  );
}

/** Memoised per document + anchor, so re-clicking a cite never refetches. */
export function sourceLookup(api: ApiClient, documentId: string) {
  const cache = new Map<string, Promise<SourceBlock[]>>();
  return (anchor: string): Promise<SourceBlock[]> => {
    let hit = cache.get(anchor);
    if (!hit) {
      hit = blocksUnder(api, documentId, anchor, PAGE);
      hit.catch(() => cache.delete(anchor));
      cache.set(anchor, hit);
    }
    return hit;
  };
}

interface TreeNodeLike {
  anchor: string;
  heading: string | null;
  children?: TreeNodeLike[];
}

/** Container headings (`anchor → heading`) from `GET /documents/{id}/tree`, per document. */
export async function loadHeadings(api: ApiClient, documentIds: readonly string[]): Promise<Record<string, Record<string, string>>> {
  const entries = await Promise.all(
    [...new Set(documentIds)].map(async (id) => {
      const headings: Record<string, string> = {};
      try {
        const tree = await api.get<{ nodes: TreeNodeLike[] }>(`documents/${id}/tree`, { query: { depth: 4 } });
        const walk = (nodes: readonly TreeNodeLike[]) =>
          nodes.forEach((n) => {
            if (n.heading) headings[n.anchor] = n.heading;
            walk(n.children ?? []);
          });
        walk(tree.nodes);
      } catch {
        // Headings are a nicety: the queue still works on anchors alone.
      }
      return [id, headings] as const;
    }),
  );
  return Object.fromEntries(entries);
}

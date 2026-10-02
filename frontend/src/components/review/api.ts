/**
 * Review-queue calls, all through an injected `ApiClient` (`browserApi` in islands,
 * `serverApi()` in page frontmatter) so components stay testable with a fake client.
 */
import type { ApiClient } from '../../lib/api/client';
import { fetchAll } from '../../lib/api/fetch-all';
import type {
  ArtifactCreate,
  ArtifactListItem,
  ArtifactPublic,
  Review,
  ReviewRequest,
} from '../../lib/api/types/artifacts';
import type { JobAccepted, JobCreate } from '../../lib/api/types/jobs';
import type { PausedState } from '../../lib/api/types/documents';

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
  /** Set when the run ceiling paused the document. */
  paused?: PausedState | null;
}

const QUEUE_STATES: readonly Review[] = ['needs_review', 'draft'];

/**
 * Everything still waiting for a human: `needs_review` and `draft`, newest first per
 * state, without versions a newer live one replaces (`latest=true`, e.g. a draft a
 * human edit retired). Without bodies (`body=false`, which keeps only `confidence`):
 * they are most of the payload, and the preview fetches the one in focus (`bodyLookup`).
 */
export async function loadQueue(api: ApiClient, maxPages = 5): Promise<ArtifactListItem[]> {
  const lists = await Promise.all(
    QUEUE_STATES.map(
      async (review) => (await fetchAll<ArtifactListItem>(api, 'artifacts', { review, latest: true, body: false }, maxPages)).items,
    ),
  );
  return lists.flat();
}

/** Memoised per artifact, so the preview of an item seen before shows at once; a failure is forgotten. */
export function bodyLookup(api: ApiClient) {
  const cache = new Map<string, Promise<ArtifactPublic['body']>>();
  return (id: string): Promise<ArtifactPublic['body']> => {
    let hit = cache.get(id);
    if (!hit) {
      hit = api.get<ArtifactPublic>(`artifacts/${id}`).then((artifact) => artifact.body);
      hit.catch(() => cache.delete(id));
      cache.set(id, hit);
    }
    return hit;
  };
}

export async function loadDocuments(api: ApiClient): Promise<DocumentLabel[]> {
  return (await fetchAll<DocumentLabel>(api, 'documents', {}, 5)).items;
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

/** Regenerate one scope: the producing job (see `rerunRequest`), forced past the idempotency skip. */
export function rerun(api: ApiClient, request: JobCreate): Promise<JobAccepted> {
  return api.post<JobAccepted>('jobs', { ...request, force: true });
}

/** Leaf blocks under an anchor (segment-aware prefix: `ch03` never matches `ch030`). */
export async function blocksUnder(api: ApiClient, documentId: string, anchor: string | null, maxPages = 3): Promise<SourceBlock[]> {
  const query = { anchor_prefix: anchor ?? undefined };
  return (await fetchAll<SourceBlock>(api, `documents/${documentId}/blocks`, query, maxPages)).items;
}

/** Memoised per document + anchor, so re-clicking a cite never refetches. */
export function sourceLookup(api: ApiClient, documentId: string) {
  const cache = new Map<string, Promise<SourceBlock[]>>();
  return (anchor: string): Promise<SourceBlock[]> => {
    let hit = cache.get(anchor);
    if (!hit) {
      hit = blocksUnder(api, documentId, anchor, 1);
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

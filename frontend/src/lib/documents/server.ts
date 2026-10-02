/**
 * Server-side loading for the document pages (frontmatter only: uses `serverApi`).
 * A missing document is `{ notFound: true }` so the page can answer 404; any other
 * failure is a `ProblemInfo` to show.
 */
import { problemOf, type ProblemInfo } from '../../components/common/Problem';
import { ApiError } from '../api/errors';
import { serverApi } from '../api/server';
import type { ArtifactListItem, ArtifactPublic, ArtifactType } from '../api/types/artifacts';
import type { DocumentDetail, DocumentTree, ReadingPosition } from '../api/types/documents';
import { fetchAll } from '../api/fetch-all';
import { MATERIALS } from './study';

export type Loaded<T> = { ok: true; value: T } | { ok: false; notFound: boolean; problem: ProblemInfo };

export async function load<T>(work: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, notFound: error instanceof ApiError && error.status === 404, problem: problemOf(error) };
  }
}

export function getDocument(ref: string): Promise<DocumentDetail> {
  return serverApi().get<DocumentDetail>(`documents/${encodeURIComponent(ref)}`);
}

/** Every document's reading positions, keyed by document id, in one call (a document never
 * opened is absent). Best effort: a failure reads as nothing opened, so no page fails on it. */
export async function getShelfReading(): Promise<Record<string, ReadingPosition[]>> {
  return await serverApi()
    .get<Record<string, ReadingPosition[]>>('reading')
    .catch(() => ({}));
}

/** Containers only (parts, chapters, sections, subsections). */
export function getOutline(ref: string): Promise<DocumentTree> {
  return serverApi().get<DocumentTree>(`documents/${encodeURIComponent(ref)}/tree`, { query: { depth: 4 } });
}

/** The whole tree with its blocks (for word counts and reading times). */
export function getFullTree(ref: string): Promise<DocumentTree> {
  return serverApi().get<DocumentTree>(`documents/${encodeURIComponent(ref)}/tree`, { query: { depth: 20, include: 'blocks' } });
}

/** Only the artifact types that are study material (lib/documents/study), one small call each:
 * the unfiltered list carries every section note and can be large. */
export async function getStudyArtifacts(documentId: string): Promise<ArtifactListItem[]> {
  const lists = await Promise.all(MATERIALS.map((m) => getArtifacts(documentId, { type: m.type })));
  return lists.flat();
}

/** A document's artifacts; `body: false` sends them without bodies, for pages that only show what exists. */
export async function getArtifacts(
  documentId: string,
  filter: { type?: ArtifactType; anchor_prefix?: string; review?: ArtifactPublic['review']; body?: false } = {},
): Promise<ArtifactListItem[]> {
  const { items } = await fetchAll<ArtifactListItem>(serverApi(), 'artifacts', { document_id: documentId, ...filter });
  return items;
}

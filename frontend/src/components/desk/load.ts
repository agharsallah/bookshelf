/**
 * Server-side loading for the Desk (page frontmatter only: uses `serverApi`). Every
 * book's outline, reading positions and study material load in parallel, capped to the
 * books touched most recently; any call that fails leaves that part of the book empty
 * instead of failing the page. Workshop counts load the same way, or not at all.
 */
import { loadNavCounts, type NavCounts } from '../shell/nav';
import { fetchAll } from '../../lib/api/fetch-all';
import { serverApi } from '../../lib/api/server';
import type { DocumentSummary, ReadingPosition } from '../../lib/api/types/documents';
import { getArtifacts, getOutline } from '../../lib/documents/server';
import { availableMaterials } from '../../lib/documents/study';
import { readingUnits } from '../../lib/documents/tree';
import { deskBook, isReadable, type DeskBook } from './desk';

/** Books looked at in detail; the rest of a large library shows on the shelf unread. */
export const DETAIL_CAP = 24;

async function detailed(doc: DocumentSummary): Promise<DeskBook> {
  if (!isReadable(doc)) return deskBook(doc, [], []);
  const [tree, reading, artifacts] = await Promise.all([
    getOutline(doc.slug).catch(() => null),
    serverApi()
      .get<ReadingPosition[]>(`documents/${encodeURIComponent(doc.slug)}/reading`)
      .catch(() => []),
    getArtifacts(doc.id).catch(() => []),
  ]);
  const units = tree ? readingUnits(tree.nodes) : [];
  return deskBook(doc, units, reading, availableMaterials(doc.slug, artifacts));
}

export async function loadDesk(): Promise<DeskBook[]> {
  const { items } = await fetchAll<DocumentSummary>(serverApi(), 'documents', {}, 5);
  const recent = [...items].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const head = await Promise.all(recent.slice(0, DETAIL_CAP).map(detailed));
  return [...head, ...recent.slice(DETAIL_CAP).map((doc) => deskBook(doc, [], []))];
}

export async function loadNeeds(): Promise<NavCounts | null> {
  return await loadNavCounts(serverApi()).catch(() => null);
}

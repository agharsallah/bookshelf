/**
 * Server-side (page frontmatter only: uses `serverApi`): the collection a page was reached
 * from (`?collection=<slug>`), so the reader and a document's page can keep it.
 */
import { getCollection } from '../../lib/collections/api';
import { serverApi } from '../../lib/api/server';
import type { PathMember } from './path';

export interface CollectionContext {
  slug: string;
  name: string;
  /** In reading order. */
  members: PathMember[];
}

/** The collection named by `slug` when the document is in it, else null; best effort. */
export async function collectionOf(slug: string | null, documentId: string): Promise<CollectionContext | null> {
  if (!slug) return null;
  try {
    const c = await getCollection(serverApi(), slug);
    const members = c.members.map((m) => ({ id: m.document.id, slug: m.document.slug, title: m.document.title, genre: m.document.genre }));
    return members.some((m) => m.id === documentId) ? { slug: c.slug, name: c.name, members } : null;
  } catch {
    return null;
  }
}

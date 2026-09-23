/**
 * Read every page of a paginated list endpoint (the API caps pages at 100), up to a
 * safety limit. Used by page frontmatter (artifacts, notes, jobs, documents) and islands.
 */
import type { ApiClient, Query } from './client';
import type { Page } from './types';

export const PAGE_SIZE = 100;

export async function fetchAll<T>(
  api: Pick<ApiClient, 'get'>,
  path: string,
  query: Query = {},
  maxPages = 20,
): Promise<{ items: T[]; complete: boolean }> {
  const items: T[] = [];
  for (let page = 0; page < maxPages; page += 1) {
    const result = await api.get<Page<T>>(path, {
      query: { ...query, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
    });
    items.push(...result.items);
    if (items.length >= result.total || result.items.length === 0) return { items, complete: true };
  }
  return { items, complete: false };
}

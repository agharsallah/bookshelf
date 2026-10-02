/**
 * Read every page of a paginated list endpoint (the API caps pages at 100), up to a
 * safety limit. Used by page frontmatter (artifacts, notes, jobs, documents) and islands.
 * The first page says how many there are; the rest are asked for together, so a long
 * list costs two round trips, not one per page.
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
  const page = (index: number) => api.get<Page<T>>(path, { query: { ...query, limit: PAGE_SIZE, offset: index * PAGE_SIZE } });
  const first = await page(0);
  const pages = Math.ceil(first.total / PAGE_SIZE);
  const fetched = Math.min(pages, maxPages);
  const rest = await Promise.all(Array.from({ length: Math.max(fetched - 1, 0) }, (_, i) => page(i + 1)));
  return { items: [first, ...rest].flatMap((p) => p.items), complete: pages <= maxPages };
}

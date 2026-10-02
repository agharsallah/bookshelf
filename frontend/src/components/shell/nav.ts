/**
 * The masthead's navigation: the reading pages everyone uses, then the workshop pages
 * (review, pipeline) shown only in workshop mode, and the counts those carry.
 */
import type { ApiClient } from '../../lib/api/client';
import type { Page } from '../../lib/api/types';
import type { JobPublic } from '../../lib/api/types/jobs';
import { collectionParam } from '../collections/path';
import { loadQueue } from '../review/api';

export interface NavItem {
  href: string;
  label: string;
  /** Other paths that belong to this item (a concept page belongs to Concepts). */
  also?: string[];
  /** Pages of another item's `also` that belong to this one (a paper's pages under /documents). */
  claims?: RegExp;
  workshop?: boolean;
  /** Which count the item wears, filled in by the browser after load. */
  count?: 'review' | 'pipeline';
}

export const NAV: readonly NavItem[] = [
  { href: '/', label: 'Today' },
  { href: '/library', label: 'Library', also: ['/documents'] },
  { href: '/papers', label: 'Papers', claims: /^\/documents\/[^/]+\/paper(\/|$)/ },
  { href: '/collections', label: 'Collections' },
  { href: '/search', label: 'Search' },
  { href: '/graph', label: 'Concepts', also: ['/concepts'] },
  { href: '/map', label: 'Map' },
  { href: '/you', label: 'You' },
  { href: '/review', label: 'Review', workshop: true, count: 'review' },
  { href: '/pipeline', label: 'Pipeline', workshop: true, count: 'pipeline' },
];

/**
 * The path the masthead marks: a document reached from a collection (`?collection=`)
 * belongs to Collections, not the Library.
 */
export function navPath(url: Pick<URL, 'pathname' | 'searchParams'>): string {
  const collection = collectionParam(url.searchParams);
  return collection && url.pathname.startsWith('/documents/') ? `/collections/${collection}` : url.pathname;
}

/** Whether `path` is inside the item: its own path or one it owns, never "/" by prefix. */
export function isCurrent(item: Pick<NavItem, 'href' | 'also' | 'claims'>, path: string): boolean {
  if (item.claims?.test(path)) return true;
  if (NAV.some((other) => other.href !== item.href && other.claims?.test(path))) return false;
  const under = (base: string) => (base === '/' ? path === '/' : path === base || path.startsWith(`${base}/`));
  return [item.href, ...(item.also ?? [])].some(under);
}

export interface NavCounts {
  /** Drafts and flagged artifacts waiting for review. */
  review: number;
  /** Jobs queued or running now. */
  active: number;
  /** Jobs that failed and were not retried. */
  failed: number;
}

export async function loadNavCounts(api: ApiClient): Promise<NavCounts> {
  const jobs = (state: string) => api.get<Page<JobPublic>>('jobs', { query: { state, limit: 1 } }).then((page) => page.total);
  const [queue, queued, running, failed] = await Promise.all([
    loadQueue(api, 1),
    jobs('queued'),
    jobs('running'),
    jobs('failed'),
  ]);
  return { review: queue.length, active: queued + running, failed };
}

/** What the pipeline dot says: busy beats broken beats quiet. */
export function pipelineSignal(counts: Pick<NavCounts, 'active' | 'failed'>): { state: 'busy' | 'failed' | 'idle'; label: string } {
  if (counts.active > 0) return { state: 'busy', label: `${counts.active} ${counts.active === 1 ? 'job' : 'jobs'} in progress` };
  if (counts.failed > 0) return { state: 'failed', label: `${counts.failed} failed ${counts.failed === 1 ? 'job' : 'jobs'}` };
  return { state: 'idle', label: 'Nothing running' };
}

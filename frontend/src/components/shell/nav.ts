/**
 * The masthead's navigation: the reading pages everyone uses, then the workshop pages
 * (review, pipeline) shown only in workshop mode, and the counts those carry.
 */
import type { ApiClient } from '../../lib/api/client';
import type { Page } from '../../lib/api/types';
import type { JobPublic } from '../../lib/api/types/jobs';
import { loadQueue } from '../review/api';

export interface NavItem {
  href: string;
  label: string;
  /** Other paths that belong to this item (a concept page belongs to Concepts). */
  also?: string[];
  workshop?: boolean;
  /** Which count the item wears, filled in by the browser after load. */
  count?: 'review' | 'pipeline';
}

export const NAV: readonly NavItem[] = [
  { href: '/', label: 'Desk' },
  { href: '/library', label: 'Library', also: ['/documents'] },
  { href: '/search', label: 'Search' },
  { href: '/graph', label: 'Concepts', also: ['/concepts'] },
  { href: '/review', label: 'Review', workshop: true, count: 'review' },
  { href: '/pipeline', label: 'Pipeline', workshop: true, count: 'pipeline' },
];

/** Whether `path` is inside the item: its own path or one it owns, never "/" by prefix. */
export function isCurrent(item: Pick<NavItem, 'href' | 'also'>, path: string): boolean {
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

/**
 * Route caching (Astro's in-process memory cache, configured in astro.config.mjs). Only
 * the Desk island opts in: it is the costliest render (dozens of backend calls) and
 * shows nothing you are editing at that moment. Reader and workshop pages stay live.
 *
 * Every write in the app goes through the /api proxy, which drops the cached Desk so
 * your own changes show at once. Work done by background jobs shows once the entry
 * ages out: fresh for `maxAge` seconds, then served stale for up to `swr` more while
 * a new render replaces it.
 */
import { MUTATING_METHODS } from './api/proxy';

export const DESK_CACHE_TAG = 'desk';

export const DESK_CACHE = { maxAge: 30, swr: 300, tags: [DESK_CACHE_TAG] };

/** The cache tags a proxied request makes stale: every write may change the Desk. */
export function staleTagsAfter(method: string): string[] {
  return MUTATING_METHODS.has(method.toUpperCase()) ? [DESK_CACHE_TAG] : [];
}

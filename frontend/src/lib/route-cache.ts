/**
 * Route caching (Astro's in-process memory cache, configured in astro.config.mjs). Only
 * Today's two islands opt in: they are the costliest renders (dozens of backend calls,
 * and the week's reader statistics) and show nothing you are editing at that moment.
 * Reader and workshop pages stay live.
 *
 * Every write in the app goes through the /api proxy, which drops the cached Today so
 * your own changes show at once. Work done by background jobs shows once the entry
 * ages out: fresh for `maxAge` seconds, then served stale for up to `swr` more while
 * a new render replaces it.
 */
import { MUTATING_METHODS } from './api/proxy';

export const TODAY_CACHE_TAG = 'today';

export const TODAY_CACHE = { maxAge: 30, swr: 300, tags: [TODAY_CACHE_TAG] };

/** The cache tags a proxied request makes stale: every write may change Today. */
export function staleTagsAfter(method: string): string[] {
  return MUTATING_METHODS.has(method.toUpperCase()) ? [TODAY_CACHE_TAG] : [];
}

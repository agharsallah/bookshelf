/**
 * Recent searches and visited concepts, kept per browser. A convenience only: every
 * storage access is guarded, so a private window or blocked storage just means "none".
 */

export interface RecentEntry {
  /** What the user typed (or the concept name). */
  label: string;
  href: string;
}

export const RECENT_SEARCHES_KEY = 'bookshelf:recent-searches';
export const RECENT_CONCEPTS_KEY = 'bookshelf:recent-concepts';
export const RECENT_LIMIT = 8;

/** Newest first, de-duplicated by href (case-insensitive label match counts too). */
export function remember(entries: readonly RecentEntry[], entry: RecentEntry, limit = RECENT_LIMIT): RecentEntry[] {
  const label = entry.label.trim();
  if (!label) return [...entries];
  const same = (e: RecentEntry) => e.href === entry.href || e.label.trim().toLowerCase() === label.toLowerCase();
  return [{ label, href: entry.href }, ...entries.filter((e) => !same(e))].slice(0, limit);
}

function isEntry(value: unknown): value is RecentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { label, href } = value as Record<string, unknown>;
  return typeof label === 'string' && typeof href === 'string' && href.startsWith('/');
}

export function loadRecent(key: string, storage: Storage | undefined = globalThis.localStorage): RecentEntry[] {
  try {
    const raw = storage?.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveRecent(key: string, entry: RecentEntry, storage: Storage | undefined = globalThis.localStorage): RecentEntry[] {
  const next = remember(loadRecent(key, storage), entry);
  try {
    storage?.setItem(key, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the list simply is not kept.
  }
  return next;
}

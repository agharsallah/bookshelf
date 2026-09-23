/**
 * Queue ordering, grouping and filtering. `needs_review` comes before `draft`; items are
 * grouped by document, and within a document follow reading order of their scope anchor.
 */
import type { ArtifactPublic, ArtifactType, Review, Tier } from '../../lib/api/types/artifacts';

export interface QueueFilters {
  type?: ArtifactType | '';
  skill?: string;
  tier?: Tier | '';
  document?: string;
}

export interface QueueGroup<T extends ArtifactPublic = ArtifactPublic> {
  documentId: string;
  title: string;
  items: T[];
  needsReview: number;
}

const REVIEW_RANK: Record<Review, number> = { needs_review: 0, draft: 1, approved: 2, rejected: 3 };

/** Only what still waits for a human: `needs_review` and `draft`. */
export function isPending(artifact: Pick<ArtifactPublic, 'review'>): boolean {
  return artifact.review === 'needs_review' || artifact.review === 'draft';
}

/** Anchors in reading order: `ch2` before `ch10`, a chapter before its sections, none first. */
export function compareAnchors(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  const left = a.split('/');
  const right = b.split('/');
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    const [, ka = '', na = '0'] = /^([a-z]+)(\d+)$/.exec(left[i] ?? '') ?? [];
    const [, kb = '', nb = '0'] = /^([a-z]+)(\d+)$/.exec(right[i] ?? '') ?? [];
    if (ka !== kb) return ka < kb ? -1 : 1;
    const diff = Number(na) - Number(nb);
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

function compareItems(a: ArtifactPublic, b: ArtifactPublic): number {
  return (
    REVIEW_RANK[a.review] - REVIEW_RANK[b.review] ||
    compareAnchors(a.anchor, b.anchor) ||
    a.type.localeCompare(b.type) ||
    b.version - a.version
  );
}

export function filterQueue<T extends ArtifactPublic>(items: readonly T[], filters: QueueFilters): T[] {
  return items.filter(
    (item) =>
      (!filters.type || item.type === filters.type) &&
      (!filters.skill || item.skill === filters.skill) &&
      (!filters.tier || item.tier === filters.tier) &&
      (!filters.document || item.document_id === filters.document),
  );
}

/**
 * Group by document. Documents with the most `needs_review` items come first, then by
 * title; each group is ordered needs_review → draft, then by anchor.
 */
export function groupQueue<T extends ArtifactPublic>(
  items: readonly T[],
  titles: Readonly<Record<string, string>>,
): QueueGroup<T>[] {
  const byDocument = new Map<string, T[]>();
  for (const item of items) {
    const list = byDocument.get(item.document_id) ?? [];
    list.push(item);
    byDocument.set(item.document_id, list);
  }
  return [...byDocument.entries()]
    .map(([documentId, list]) => ({
      documentId,
      title: titles[documentId] ?? 'Untitled document',
      items: [...list].sort(compareItems),
      needsReview: list.filter((i) => i.review === 'needs_review').length,
    }))
    .sort((a, b) => b.needsReview - a.needsReview || a.title.localeCompare(b.title));
}

/** Ids in the order j/k walks them. */
export function flatOrder(groups: readonly QueueGroup[]): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.id));
}

/** Distinct, sorted values of a field, for filter menus. */
export function facet<T extends ArtifactPublic, K extends keyof T>(items: readonly T[], key: K): NonNullable<T[K]>[] {
  const values = new Set<NonNullable<T[K]>>();
  for (const item of items) {
    const value = item[key];
    if (value !== null && value !== undefined) values.add(value as NonNullable<T[K]>);
  }
  return [...values].sort();
}

/**
 * One item per scope (document, type, anchor, note): the highest version. The backend
 * keeps an older pending version's review state after a newer one is written, so
 * without this an edited artifact would still show its superseded draft.
 */
const scopeKey = (a: ArtifactPublic) => [a.document_id, a.type, a.anchor ?? '', a.note_id ?? ''].join('|');

export function latestPerScope<T extends ArtifactPublic>(items: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const item of items) {
    const key = scopeKey(item);
    const current = best.get(key);
    if (!current || item.version > current.version) best.set(key, item);
  }
  return items.filter((item) => best.get(scopeKey(item)) === item);
}

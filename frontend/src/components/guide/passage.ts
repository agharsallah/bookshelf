/**
 * Opening a cited passage in place: which chapter holds it, where it sits in that
 * chapter, and loading the chapter's text once per page visit.
 */
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { DocumentTree, NodeSubtree, TreeNode } from '../../lib/api/types/documents';
import { flatten, isUnder, readingUnits, type FlatNode } from '../../lib/documents/tree';
import { chapterLabel } from './guide';

/** A chapter the panel can show: its address, title and the book's number for it. */
export interface PassageUnit {
  anchor: string;
  heading: string;
  label: string;
}

/** Where a passage can open in place: every chapter, with the book's number for it. */
export function passageUnitsOf(nodes: readonly TreeNode[]): PassageUnit[] {
  return readingUnits(nodes).map((u) => ({ anchor: u.anchor, heading: u.heading ?? u.anchor, label: chapterLabel(u.anchor) }));
}

const outlines = new Map<string, Promise<PassageUnit[]>>();

/** A document's chapters (`GET /documents/{slug}/tree`), fetched once per page visit. */
export function loadUnits(slug: string, api: Pick<ApiClient, 'get'> = browserApi): Promise<PassageUnit[]> {
  let loading = outlines.get(slug);
  if (!loading) {
    loading = api.get<DocumentTree>(`documents/${encodeURIComponent(slug)}/tree`, { query: { depth: 4 } }).then((tree) => passageUnitsOf(tree.nodes));
    // A failed load is not remembered, so opening a passage again retries.
    loading.catch(() => outlines.delete(slug));
    outlines.set(slug, loading);
  }
  return loading;
}

/** The chapter that holds `anchor`, or null when it lies outside every chapter. */
export function unitOfAnchor(units: readonly PassageUnit[], anchor: string): PassageUnit | null {
  return units.find((u) => isUnder(anchor, u.anchor)) ?? null;
}

/** The chapters either side of `unit`, for browsing on from the panel. */
export function neighbours(units: readonly PassageUnit[], unit: PassageUnit): { previous: PassageUnit | null; next: PassageUnit | null } {
  const at = units.findIndex((u) => u.anchor === unit.anchor);
  return { previous: at > 0 ? (units[at - 1] ?? null) : null, next: at >= 0 ? (units[at + 1] ?? null) : null };
}

/**
 * The block to point at: the cited node itself, else the first block under it (a
 * section or chapter cite), else null (the cite is the chapter as a whole).
 */
export function targetBlock(flat: readonly FlatNode[], anchor: string): string | null {
  return flat.find(({ node }) => node.anchor === anchor)?.node.anchor ?? flat.find(({ node }) => isUnder(node.anchor, anchor))?.node.anchor ?? null;
}

/** The heading of the section the cited block sits in, for the panel's header. */
export function sectionHeading(flat: readonly FlatNode[], anchor: string): string | null {
  const hit = flat.find(({ node }) => node.anchor === anchor || isUnder(anchor, node.anchor) || isUnder(node.anchor, anchor));
  if (!hit) return null;
  const section = flat.find(({ node }) => node.anchor === hit.section);
  return section?.node.heading ?? null;
}

export interface LoadedChapter {
  unit: TreeNode;
  flat: FlatNode[];
  truncated: boolean;
}

const cache = new Map<string, Promise<LoadedChapter>>();

/** The chapter's text (`GET /nodes/{slug}/{anchor}`), fetched once per page visit. */
export function loadChapter(slug: string, anchor: string, api: Pick<ApiClient, 'get'> = browserApi): Promise<LoadedChapter> {
  const key = `${slug}/${anchor}`;
  let loading = cache.get(key);
  if (!loading) {
    loading = api
      .get<NodeSubtree>(`nodes/${encodeURIComponent(slug)}/${anchor}`)
      .then((res) => ({ unit: res.node, flat: flatten(res.node), truncated: res.truncated }));
    // A failed load is not remembered, so opening the passage again retries.
    loading.catch(() => cache.delete(key));
    cache.set(key, loading);
  }
  return loading;
}

/** For tests: forget every loaded chapter and outline. */
export function clearChapterCache(): void {
  cache.clear();
  outlines.clear();
}

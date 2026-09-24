/**
 * Navigating the document tree by anchor (`ch03/s02/p014`). The reader works one
 * chapter at a time; parts only group chapters, and documents without chapters
 * (short articles) read their top-level nodes as units instead.
 */
import type { TreeNode } from '../api/types/documents';

/** True when `anchor` is `prefix` or lies under it (segment-aware: `ch1` never matches `ch10`). */
export function isUnder(anchor: string, prefix: string): boolean {
  return anchor === prefix || anchor.startsWith(`${prefix}/`);
}

/** The container path of an anchor: `ch03/s02/p014` → `ch03/s02`; top level → itself. */
export function parentAnchor(anchor: string): string {
  const cut = anchor.lastIndexOf('/');
  return cut === -1 ? anchor : anchor.slice(0, cut);
}

function* walk(nodes: readonly TreeNode[]): Generator<TreeNode> {
  for (const node of nodes) {
    yield node;
    yield* walk(node.children);
  }
}

/** Chapters in reading order (inside parts too); top-level nodes when there are none. */
export function readingUnits(nodes: readonly TreeNode[]): TreeNode[] {
  const chapters = [...walk(nodes)].filter((n) => n.kind === 'chapter');
  return chapters.length > 0 ? chapters : nodes.filter((n) => n.kind !== 'part');
}

/** The unit to open when no anchor is given: the first real chapter, skipping front matter. */
export function defaultUnit(units: readonly TreeNode[]): TreeNode | undefined {
  return units.find((u) => !u.meta.front_matter) ?? units[0];
}

/** The unit that contains `anchor`; a part resolves to its first chapter. */
export function unitFor(units: readonly TreeNode[], anchor: string): TreeNode | undefined {
  return (
    units.find((u) => isUnder(anchor, u.anchor)) ?? units.find((u) => isUnder(u.anchor, anchor))
  );
}

/** Every node of a subtree in reading order, with the container each leaf sits in. */
export interface FlatNode {
  node: TreeNode;
  /** Nearest section (or the unit itself) — what the distillation pane follows. */
  section: string;
}

export function flatten(unit: TreeNode): FlatNode[] {
  const out: FlatNode[] = [];
  const visit = (node: TreeNode, section: string) => {
    const here = node.kind === 'section' ? node.anchor : section;
    out.push({ node, section: here });
    node.children.forEach((child) => visit(child, here));
  };
  unit.children.forEach((child) => visit(child, unit.anchor));
  return out;
}

/** Per flat node, the page to mark in the margin: only where it changes, never on a section heading. */
export function pageMarkers(flat: readonly FlatNode[]): (number | null)[] {
  let last: number | null = null;
  return flat.map(({ node }) => {
    if (node.page_from === null || node.kind === 'section') return null;
    const changed = node.page_from !== last;
    last = node.page_from;
    return changed ? node.page_from : null;
  });
}

/** Sections of a unit, nested, for the navigator. */
export function sectionsOf(unit: TreeNode): TreeNode[] {
  return unit.children.filter((c) => c.kind === 'section');
}

/** Page span of a node as "pp. 12–18" / "p. 12" / "". */
export function pageSpan(node: Pick<TreeNode, 'page_from' | 'page_to'>): string {
  const { page_from: from, page_to: to } = node;
  if (from === null) return '';
  if (to === null || to === from) return `p. ${from}`;
  return `pp. ${from}–${to}`;
}

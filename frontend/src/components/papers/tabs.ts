/**
 * The paper page's tabs (`/documents/[ref]/paper/[tab]`, docs/PAPERS.md §8), as data.
 *
 * Adding a tab is two small steps:
 *   1. an entry here (`key` is the URL segment, `types` the artifacts it shows), and
 *   2. its view in `tab-views.ts` (an Astro component taking `TabViewProps`), which the
 *      type `Record<PaperTabKey, …>` there makes compulsory.
 * The tab bar, readiness dots and the page's routing follow from this list.
 */
import type { ArtifactType } from '../../lib/api/types/artifacts';
import type { PaperArtifactState, PaperDetail } from '../../lib/api/types/papers';

export interface PaperTab {
  /** The URL segment: `/documents/<slug>/paper/<key>`. */
  key: string;
  label: string;
  /** Artifact types the tab shows; its readiness is theirs. Empty: the tab reads tables
   * (references, ratings) and is always available. */
  types: readonly ArtifactType[];
}

/** What every tab view (`tab-views.ts`) receives; it loads anything else it shows. */
export interface TabViewProps {
  paper: PaperDetail;
  /** The page URL, for the tab's own query params (`?level=`, `?intent=`). */
  url: URL;
}

export const PAPER_TABS = [
  { key: 'card', label: 'Card', types: ['paper_card'] },
  { key: 'explain', label: 'Explain', types: ['paper_explainer'] },
  { key: 'claims', label: 'Claims', types: ['claim_set'] },
  { key: 'results', label: 'Results', types: ['results_table'] },
  { key: 'references', label: 'References', types: [] },
  { key: 'notation', label: 'Notation', types: ['notation_table'] },
  { key: 'review', label: 'Review', types: ['paper_assessment', 'paper_review'] },
  { key: 'club', label: 'Journal club', types: ['journal_club'] },
] as const satisfies readonly PaperTab[];

export type PaperTabKey = (typeof PAPER_TABS)[number]['key'];

export const DEFAULT_TAB: PaperTabKey = 'card';

export function paperTab(key: string | undefined): (PaperTab & { key: PaperTabKey }) | null {
  return PAPER_TABS.find((t) => t.key === key) ?? null;
}

/** `/documents/<slug>/paper/<tab>`, with an optional query (`level=expert`). */
export function paperHref(slug: string, tab: PaperTabKey = DEFAULT_TAB, query: Record<string, string> = {}): string {
  const qs = new URLSearchParams(query).toString();
  return `/documents/${encodeURIComponent(slug)}/paper/${tab}${qs ? `?${qs}` : ''}`;
}

/** `approved`: at least one approved artifact · `draft`: only unreviewed ones ·
 * `missing`: none yet · `data`: the tab reads tables, not artifacts. */
export type Readiness = 'approved' | 'draft' | 'missing' | 'data';

export function readinessOf(tab: Pick<PaperTab, 'types'>, artifacts: readonly Pick<PaperArtifactState, 'type' | 'review'>[]): Readiness {
  if (tab.types.length === 0) return 'data';
  const mine = artifacts.filter((a) => tab.types.includes(a.type) && a.review !== 'rejected');
  if (mine.some((a) => a.review === 'approved')) return 'approved';
  return mine.length > 0 ? 'draft' : 'missing';
}

export interface TabItem {
  key: PaperTabKey;
  label: string;
  href: string;
  readiness: Readiness;
  current: boolean;
}

/** The tab bar: every tab, its link, whether its material exists, and which is open. */
export function tabItems(slug: string, artifacts: readonly PaperArtifactState[], current: PaperTabKey): TabItem[] {
  return PAPER_TABS.map((tab) => ({
    key: tab.key,
    label: tab.label,
    href: paperHref(slug, tab.key),
    readiness: readinessOf(tab, artifacts),
    current: tab.key === current,
  }));
}

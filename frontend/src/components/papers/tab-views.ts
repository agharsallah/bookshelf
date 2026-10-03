/**
 * The view of each paper tab (see ./tabs for the registry). A new tab's key must be
 * added here too: `Record<PaperTabKey, …>` fails the type check until it is.
 * Views are Astro components taking `TabViewProps`; they load what they show.
 */
import type { PaperTabKey, TabViewProps } from './tabs';
import BuildTab from './views/BuildTab.astro';
import CardTab from './views/CardTab.astro';
import ClaimsTab from './views/ClaimsTab.astro';
import ClubTab from './views/ClubTab.astro';
import ExplainTab from './views/ExplainTab.astro';
import MathTab from './views/MathTab.astro';
import NotationTab from './views/NotationTab.astro';
import ReferencesTab from './views/ReferencesTab.astro';
import ResultsTab from './views/ResultsTab.astro';
import ReviewTab from './views/ReviewTab.astro';

/** An Astro component's default export, as the type checker sees it. */
type TabView = (props: TabViewProps) => unknown;

export const TAB_VIEWS: Record<PaperTabKey, TabView> = {
  card: CardTab,
  explain: ExplainTab,
  math: MathTab,
  claims: ClaimsTab,
  results: ResultsTab,
  references: ReferencesTab,
  notation: NotationTab,
  review: ReviewTab,
  club: ClubTab,
  build: BuildTab,
};

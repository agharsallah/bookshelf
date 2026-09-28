/**
 * Three-pass reading of a paper (docs/PAPERS.md §6), as pure rules over one reading unit.
 *
 * The reader shows one top-level unit at a time; each carries its section role
 * (`meta.role`, set by paper_structure). A pass decides, per unit and block, what stays:
 *
 * - **Pass 1, skim**: the abstract, introduction and conclusion in full. Elsewhere only
 *   the section headings (folded, with their length and reading time) and the figures
 *   and tables with their captions. References and appendices fold whole.
 * - **Pass 2, read**: every body unit in full, figures and tables emphasised; the
 *   appendix and references fold whole.
 * - **Pass 3, re-create**: everything.
 *
 * A fold stands where its section heading (or, for text before the first heading, the
 * unit) begins, so the layout keeps the paper's order.
 */
import type { TreeNode } from '../../../lib/api/types/documents';
import type { PassNumber, SectionRole } from '../../../lib/api/types/papers';
import { WORDS_PER_MINUTE, wordCount } from '../progress';

/** Units read in full on the first pass. */
const SKIM_ROLES: ReadonlySet<string> = new Set<SectionRole>(['abstract', 'introduction', 'conclusion']);
/** Units outside the body: folded whole until pass 3. */
const OUTSIDE_BODY: ReadonlySet<string> = new Set<SectionRole>(['references', 'appendix']);
/** Blocks a skim keeps anywhere: what the paper shows rather than says. */
const PICTURE_KINDS: ReadonlySet<string> = new Set(['figure', 'table']);

/** A section (or unit) set aside by the pass, with how much it holds. */
export interface Fold {
  /** The heading block it replaces, or the unit when the text precedes any heading. */
  anchor: string;
  /** The section's heading; `LEAD_HEADING` for the text before a unit's first heading. */
  heading: string;
  /** The text before the unit's first heading (the unit's own name is already in the toolbar). */
  lead: boolean;
  /** Depth below the unit, as the heading would have been drawn. */
  level: number;
  /** The blocks it hides, in order (figures and tables it holds stay on screen). */
  members: string[];
  words: number;
  minutes: number;
}

export type PassItem = { type: 'block'; index: number } | { type: 'fold'; fold: Fold };

/** How a pass treats a whole unit, by its role. */
export type UnitTreatment = 'full' | 'skim' | 'folded';

export function unitTreatment(pass: PassNumber, role: string | null | undefined): UnitTreatment {
  if (pass === 3) return 'full';
  if (role && OUTSIDE_BODY.has(role)) return 'folded';
  if (pass === 2) return 'full';
  return role && SKIM_ROLES.has(role) ? 'full' : 'skim';
}

export function readingMinutes(words: number): number {
  return words > 0 ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : 0;
}

/** What the fold of a unit's text before its first heading is called. */
export const LEAD_HEADING = 'Opening';

/** "4 blocks, 620 words, 3 min" for a fold. */
export function foldLabel(fold: Pick<Fold, 'members' | 'words' | 'minutes'>): string {
  const n = fold.members.length;
  const blocks = `${n} ${n === 1 ? 'block' : 'blocks'}`;
  if (fold.words === 0) return blocks;
  return `${blocks}, ${fold.words.toLocaleString('en')} words, ${fold.minutes} min`;
}

interface Flat {
  node: TreeNode;
}

/**
 * What the pass shows of a unit, in reading order. `pass` null (the mode is off) keeps
 * every block, so a book or a paper read normally renders exactly as before. `opened`
 * holds folds the reader unfolded: their heading and blocks show as usual.
 */
export function planUnit(pass: PassNumber | null, unit: TreeNode, flat: readonly Flat[], opened: ReadonlySet<string> = new Set()): PassItem[] {
  const all = (): PassItem[] => flat.map((_, index) => ({ type: 'block', index }));
  if (pass === null) return all();
  const role = typeof unit.meta.role === 'string' ? unit.meta.role : null;
  const treatment = unitTreatment(pass, role);
  if (treatment === 'full' || (treatment === 'folded' && opened.has(unit.anchor))) return all();

  const items: PassItem[] = [];
  const add = (fold: Fold, node: TreeNode) => {
    fold.members.push(node.anchor);
    fold.words += wordCount(node.text ?? '');
    fold.minutes = readingMinutes(fold.words);
  };
  const newFold = (anchor: string, heading: string, level: number, lead = false): Fold => {
    const fold: Fold = { anchor, heading, level, lead, members: [], words: 0, minutes: 0 };
    items.push({ type: 'fold', fold });
    return fold;
  };
  if (treatment === 'folded') {
    const fold = newFold(unit.anchor, unit.heading ?? unit.anchor, 0);
    flat.forEach(({ node }) => {
      if (node.kind !== 'section') add(fold, node);
    });
    return items;
  }

  // Skim: each heading folds the blocks up to the next one; pictures stay.
  let current: Fold | null = null;
  // Text before the first heading folds as the unit's opening; opening it shows just that.
  let showing = opened.has(unit.anchor);
  flat.forEach(({ node }, index) => {
    if (node.kind === 'section') {
      showing = opened.has(node.anchor);
      current = showing ? null : newFold(node.anchor, node.heading ?? node.anchor, node.depth - unit.depth);
      if (showing) items.push({ type: 'block', index });
      return;
    }
    if (showing || PICTURE_KINDS.has(node.kind)) {
      items.push({ type: 'block', index });
      return;
    }
    current ??= newFold(unit.anchor, LEAD_HEADING, 0, true);
    add(current, node);
  });
  return items;
}

/** Fold anchor of the fold hiding `anchor`, if a fold hides it. */
export function foldOf(items: readonly PassItem[], anchor: string): string | null {
  for (const item of items) {
    if (item.type === 'fold' && (item.fold.anchor === anchor || item.fold.members.includes(anchor))) return item.fold.anchor;
  }
  return null;
}

/** The anchors a pass keeps on screen, for j/k and the "reading" spotlight. */
export function visibleAnchors(items: readonly PassItem[], flat: readonly Flat[]): string[] {
  return items.flatMap((item) => {
    if (item.type === 'fold') return [item.fold.anchor];
    const node = flat[item.index]?.node;
    return node ? [node.anchor] : [];
  });
}

export interface RoledUnit {
  anchor: string;
  role?: string | null;
}

/**
 * The unit whose end closes the pass: for passes 1 and 2 the conclusion (else the last
 * body unit; acknowledgements, references and appendices come after it), for pass 3 the
 * paper's last unit.
 */
export function closingUnit(pass: PassNumber, units: readonly RoledUnit[]): string | null {
  if (pass === 3) return units.at(-1)?.anchor ?? null;
  const conclusion = units.findLast((u) => u.role === 'conclusion');
  const body = units.filter((u) => !(u.role && OUTSIDE_BODY.has(u.role)));
  return (conclusion ?? body.at(-1) ?? units.at(-1))?.anchor ?? null;
}

/** The unit a pass-1 prediction is filed under: the abstract, else the first unit. */
export function predictionUnit(units: readonly RoledUnit[]): string | null {
  return (units.find((u) => u.role === 'abstract') ?? units[0])?.anchor ?? null;
}

/** Where to start the mode: the first pass not done yet, else the last. */
export function nextPass(done: readonly number[]): PassNumber {
  if (!done.includes(1)) return 1;
  if (!done.includes(2)) return 2;
  return 3;
}

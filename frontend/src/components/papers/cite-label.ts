/**
 * Cite labels in the paper's own section numbers. `anchorLabel` numbers by anchor position
 * (`ch04/s01/p003` → `4.1 ¶3`), which in a paper is off by the abstract and front matter:
 * BERT's `ch04` is "3 BERT". Here the unit's printed number replaces the chapter position
 * (`3.1 ¶3`), appendix letters included (`A.2 ¶1`); an unnumbered unit with a short heading
 * is named (`Abstract ¶2`), any other keeps the anchor label. Subsections are assumed
 * numbered in order under their unit, as papers print them.
 */
import { anchorLabel } from '../../lib/anchors';
import type { Anchor } from '../../lib/contract';
import { unitOfAnchor, type PassageUnit } from '../guide/passage';

const NUMBERED = /^(\d+)(?:\.|\s|$)/;
const LETTERED = /^([A-Z])(?:\.|\s)/;
const SHORT_HEADING = 24; // characters: "Abstract", "Acknowledgements", not a full title

/** Each unit's printed number, by anchor. Letters count only when the paper letters its
 * appendices from A in order (so "A Study of…" is not read as appendix A). */
export function unitNumbers(units: readonly PassageUnit[]): Map<string, string> {
  const numbers = new Map<string, string>();
  const letters: [string, string][] = [];
  for (const unit of units) {
    const heading = unit.heading.trim();
    const number = NUMBERED.exec(heading)?.[1];
    if (number) numbers.set(unit.anchor, number);
    else {
      const letter = LETTERED.exec(heading)?.[1];
      if (letter) letters.push([unit.anchor, letter]);
    }
  }
  const inOrder = letters.length >= 2 && letters.every(([, l], i) => l === String.fromCharCode(65 + i));
  if (inOrder) for (const [anchor, letter] of letters) numbers.set(anchor, letter);
  return numbers;
}

/** `(anchor) => label` in the paper's section numbers, falling back to `anchorLabel`. */
export function paperCiteLabel(units: readonly PassageUnit[]): (anchor: Anchor) => string {
  const numbers = unitNumbers(units);
  return (anchor) => {
    const unit = unitOfAnchor(units, anchor);
    if (!unit) return anchorLabel(anchor);
    const heading = unit.heading.trim();
    const number = numbers.get(unit.anchor) ?? (heading.length <= SHORT_HEADING ? heading : undefined);
    if (!number) return anchorLabel(anchor);
    const rest = anchor.slice(unit.anchor.length).replace(/^\//, '');
    if (!rest) return number;
    const tail = anchorLabel(`x1/${rest}`).replace(/^1(?=[.\s]|$)/, '');
    return `${number}${tail}`;
  };
}

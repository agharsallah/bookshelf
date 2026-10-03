/**
 * Marks reaching the end of a chapter you had not finished before: a toast in the chosen
 * voice, and the end of the book with a burst too. Once per chapter per page; nothing
 * when what you had finished is unknown (`finishedBefore` null). Front matter belongs in
 * `finishedBefore` from the start: it never holds up the end of a book.
 */
import { useEffect, useRef } from 'react';
import { celebrate } from './celebrate';
import { chapterDone } from './lines';

interface Unit {
  anchor: string;
  heading: string | null;
}

/** Whether finishing `anchor` finishes the book: every other unit is done. */
export function finishesBook(units: readonly Pick<Unit, 'anchor'>[], done: ReadonlySet<string>, anchor: string): boolean {
  return units.every((u) => u.anchor === anchor || done.has(u.anchor));
}

export function useChapterCheer({
  atEnd,
  unit,
  units,
  finishedBefore,
  book,
}: {
  atEnd: boolean;
  unit: Unit;
  units: readonly Unit[];
  finishedBefore: readonly string[] | null;
  book: string;
}): void {
  const done = useRef<Set<string> | null>(finishedBefore ? new Set(finishedBefore) : null);
  useEffect(() => {
    const seen = done.current;
    if (!atEnd || !seen || seen.has(unit.anchor)) return;
    const whole = finishesBook(units, seen, unit.anchor);
    seen.add(unit.anchor);
    celebrate(chapterDone(unit.heading ?? unit.anchor, whole ? book : null), { big: whole });
  }, [atEnd, unit, units, book]);
}

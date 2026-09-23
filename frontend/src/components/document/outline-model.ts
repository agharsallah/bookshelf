/**
 * The outline fix-up editor's model (§8): the same shape `PATCH /documents/{ref}/outline`
 * takes, which is the parser's own (backend/app/schemas/outline.py): `page_to` is
 * optional (the chapter then runs to the next one) and `skip` keeps a chapter out of
 * distillation. Operations are pure and return a new outline; `validate` mirrors the
 * backend's rules so problems show before the request is sent.
 */
import type { OutlineChapter, OutlineSection, TreeNode } from '../../lib/api/types/documents';
import { readingUnits } from '../../lib/documents/tree';

export type Outline = OutlineChapter[];

export interface OutlineProblem {
  chapter: number;
  section?: number;
  message: string;
}

/** Build an editable outline from the parsed tree (or reuse a stored override). */
export function outlineFromTree(nodes: readonly TreeNode[], pageCount: number | null): Outline {
  const units = readingUnits(nodes).filter((u) => !u.meta.front_matter);
  return units.map((unit, index) => {
    const next = units[index + 1];
    const from = unit.page_from ?? 1;
    const to = unit.page_to ?? (next?.page_from ? Math.max(from, next.page_from - 1) : (pageCount ?? from));
    return {
      title: unit.heading?.trim() || `Chapter ${index + 1}`,
      page_from: from,
      page_to: Math.max(from, to),
      ...(unit.meta.skip === true ? { skip: true } : {}),
      sections: unit.children
        .filter((c) => c.kind === 'section')
        .map((s) => ({ title: s.heading?.trim() || 'Section', page_from: Math.min(Math.max(s.page_from ?? from, from), Math.max(from, to)) })),
    };
  });
}

/** A chapter's last page as the editor may assume it: its own, else up to the next chapter. */
export function effectiveEnd(outline: Outline, index: number, pageCount: number | null): number | null {
  const ch = outline[index];
  if (!ch) return null;
  if (typeof ch.page_to === 'number') return ch.page_to;
  const next = outline[index + 1];
  if (next) return Math.max(ch.page_from, next.page_from);
  return pageCount;
}

const TITLE_MAX = 500;

/**
 * The backend's rules (backend/app/schemas/outline.py and `set_outline`): titles 1–500
 * characters; pages 1-based; `page_to >= page_from` when given; sections inside their
 * chapter's pages and in page order; chapters in page order and none starting before
 * the previous one's `page_to` (sharing a boundary page is fine); nothing past
 * `page_count`.
 */
export function validate(outline: Outline, pageCount: number | null): OutlineProblem[] {
  const problems: OutlineProblem[] = [];
  outline.forEach((ch, i) => {
    const name = ch.title.trim() || `Chapter ${i + 1}`;
    const to = typeof ch.page_to === 'number' ? ch.page_to : null;
    if (!ch.title.trim()) problems.push({ chapter: i, message: `Chapter ${i + 1} needs a title.` });
    if (ch.title.trim().length > TITLE_MAX) problems.push({ chapter: i, message: `'${name}': the title is longer than ${TITLE_MAX} characters.` });
    if (!Number.isInteger(ch.page_from) || ch.page_from < 1) problems.push({ chapter: i, message: `'${name}': the first page must be 1 or more.` });
    if (to !== null && to < ch.page_from) problems.push({ chapter: i, message: `'${name}': the last page is before the first.` });
    if (pageCount !== null && Math.max(ch.page_from, to ?? 0) > pageCount) {
      problems.push({ chapter: i, message: `'${name}': the document has only ${pageCount} pages.` });
    }
    const before = outline[i - 1];
    if (before && ch.page_from < before.page_from) {
      problems.push({ chapter: i, message: `'${name}' starts before '${before.title}' does; keep chapters in page order.` });
    } else if (before && typeof before.page_to === 'number' && ch.page_from < before.page_to) {
      problems.push({ chapter: i, message: `'${name}' starts before '${before.title}' ends.` });
    }
    let previous = ch.page_from;
    ch.sections.forEach((s, j) => {
      const label = s.title.trim() || `Section ${j + 1}`;
      if (!s.title.trim()) problems.push({ chapter: i, section: j, message: `A section in '${name}' needs a title.` });
      if (s.page_from < ch.page_from || (to !== null && s.page_from > to)) {
        problems.push({ chapter: i, section: j, message: `'${label}' starts outside its chapter's pages.` });
        return; // an out-of-range section does not move the ordering baseline
      }
      if (s.page_from < previous) {
        problems.push({ chapter: i, section: j, message: `'${label}' starts before the section above it.` });
      }
      previous = Math.max(previous, s.page_from);
    });
  });
  return problems;
}

const replace = (outline: Outline, index: number, chapter: OutlineChapter): Outline =>
  outline.map((c, i) => (i === index ? chapter : c));

/** Mark a chapter as not distilled (front/back matter, an index), or undo that. */
export function setSkip(outline: Outline, index: number, skip: boolean): Outline {
  const chapter = outline[index];
  return chapter ? replace(outline, index, { ...chapter, skip }) : outline;
}

export function rename(outline: Outline, index: number, title: string): Outline {
  const chapter = outline[index];
  return chapter ? replace(outline, index, { ...chapter, title }) : outline;
}

export function setPages(outline: Outline, index: number, pages: { page_from?: number; page_to?: number | null }): Outline {
  const chapter = outline[index];
  return chapter ? replace(outline, index, { ...chapter, ...pages }) : outline;
}

/**
 * Merge chapter `index` with the one after it: the first title is kept, the pages
 * span both (open-ended if the second was), and the second chapter becomes a section
 * so its heading is not lost.
 */
export function mergeWithNext(outline: Outline, index: number): Outline {
  const a = outline[index];
  const b = outline[index + 1];
  if (!a || !b) return outline;
  const end = typeof b.page_to === 'number' ? Math.max(b.page_to, a.page_to ?? b.page_to) : null;
  const merged: OutlineChapter = {
    ...a,
    page_to: end,
    sections: [...a.sections, { title: b.title, page_from: b.page_from }, ...b.sections],
  };
  return [...outline.slice(0, index), merged, ...outline.slice(index + 2)];
}

/**
 * Split chapter `index` so a new chapter titled `title` starts at `page`. Sections
 * from `page` on move to the new chapter. The old chapter ends on the page before,
 * unless both share the page (a chapter may start mid-page where the last one ends).
 * An open-ended chapter stays open-ended in its second half.
 */
export function split(outline: Outline, index: number, page: number, title: string): Outline {
  const ch = outline[index];
  if (!ch || page <= ch.page_from || (typeof ch.page_to === 'number' && page > ch.page_to)) return outline;
  const keep = ch.sections.filter((s) => s.page_from < page);
  const move = ch.sections.filter((s) => s.page_from >= page);
  const first: OutlineChapter = { ...ch, page_to: page - 1, sections: keep };
  const second: OutlineChapter = { title, page_from: page, page_to: ch.page_to ?? null, ...(ch.skip ? { skip: true } : {}), sections: move };
  return [...outline.slice(0, index), first, second, ...outline.slice(index + 1)];
}

export function removeChapter(outline: Outline, index: number): Outline {
  return outline.filter((_, i) => i !== index);
}

/** Add a section, kept in page order within the chapter. */
export function addSection(outline: Outline, index: number, section: OutlineSection): Outline {
  const ch = outline[index];
  if (!ch) return outline;
  const sections = [...ch.sections, section].sort((a, b) => a.page_from - b.page_from);
  return replace(outline, index, { ...ch, sections });
}

export function updateSection(outline: Outline, index: number, at: number, change: Partial<OutlineSection>): Outline {
  const ch = outline[index];
  if (!ch?.sections[at]) return outline;
  return replace(outline, index, {
    ...ch,
    sections: ch.sections.map((s, j) => (j === at ? { ...s, ...change } : s)),
  });
}

export function removeSection(outline: Outline, index: number, at: number): Outline {
  const ch = outline[index];
  if (!ch) return outline;
  return replace(outline, index, { ...ch, sections: ch.sections.filter((_, j) => j !== at) });
}

/** Trimmed titles, `page_to` only when set and `skip` only when true: ready to send. */
export function toPayload(outline: Outline): { chapters: Outline } {
  return {
    chapters: outline.map((c) => ({
      title: c.title.trim(),
      page_from: c.page_from,
      ...(typeof c.page_to === 'number' ? { page_to: c.page_to } : {}),
      ...(c.skip ? { skip: true } : {}),
      sections: c.sections.map((s) => ({ title: s.title.trim(), page_from: s.page_from })),
    })),
  };
}

/** Same outline once sent? (`null` vs missing `page_to`, `false` vs missing `skip` are equal.) */
export function sameOutline(a: Outline, b: Outline): boolean {
  return JSON.stringify(toPayload(a)) === JSON.stringify(toPayload(b));
}

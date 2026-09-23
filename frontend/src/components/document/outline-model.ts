/**
 * The outline fix-up editor's model (§8): the same shape `PATCH /documents/{ref}/outline`
 * takes. Operations are pure and return a new outline; `validate` mirrors the
 * backend's rules (backend/app/schemas/document.py `OutlineChapter`/`OutlineUpdate`)
 * so problems show before the request is sent.
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
      sections: unit.children
        .filter((c) => c.kind === 'section')
        .map((s) => ({ title: s.heading?.trim() || 'Section', page_from: Math.min(Math.max(s.page_from ?? from, from), Math.max(from, to)) })),
    };
  });
}

export function validate(outline: Outline, pageCount: number | null): OutlineProblem[] {
  const problems: OutlineProblem[] = [];
  outline.forEach((ch, i) => {
    const name = ch.title.trim() || `Chapter ${i + 1}`;
    if (!ch.title.trim()) problems.push({ chapter: i, message: `Chapter ${i + 1} needs a title.` });
    if (ch.title.length > 300) problems.push({ chapter: i, message: `'${name}': the title is longer than 300 characters.` });
    if (!Number.isInteger(ch.page_from) || ch.page_from < 1) problems.push({ chapter: i, message: `'${name}': the first page must be 1 or more.` });
    if (ch.page_to < ch.page_from) problems.push({ chapter: i, message: `'${name}': the last page is before the first.` });
    if (pageCount !== null && ch.page_to > pageCount) {
      problems.push({ chapter: i, message: `'${name}': the document has only ${pageCount} pages.` });
    }
    const before = outline[i - 1];
    if (before && ch.page_from < before.page_to) {
      problems.push({ chapter: i, message: `'${name}' starts before '${before.title}' ends.` });
    }
    let previous = ch.page_from;
    ch.sections.forEach((s, j) => {
      const label = s.title.trim() || `Section ${j + 1}`;
      if (!s.title.trim()) problems.push({ chapter: i, section: j, message: `A section in '${name}' needs a title.` });
      if (s.page_from < ch.page_from || s.page_from > ch.page_to) {
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

export function rename(outline: Outline, index: number, title: string): Outline {
  const chapter = outline[index];
  return chapter ? replace(outline, index, { ...chapter, title }) : outline;
}

export function setPages(outline: Outline, index: number, pages: { page_from?: number; page_to?: number }): Outline {
  const chapter = outline[index];
  return chapter ? replace(outline, index, { ...chapter, ...pages }) : outline;
}

/**
 * Merge chapter `index` with the one after it: the first title is kept, the pages
 * span both, and the second chapter becomes a section so its heading is not lost.
 */
export function mergeWithNext(outline: Outline, index: number): Outline {
  const a = outline[index];
  const b = outline[index + 1];
  if (!a || !b) return outline;
  const merged: OutlineChapter = {
    title: a.title,
    page_from: a.page_from,
    page_to: Math.max(a.page_to, b.page_to),
    sections: [...a.sections, { title: b.title, page_from: b.page_from }, ...b.sections],
  };
  return [...outline.slice(0, index), merged, ...outline.slice(index + 2)];
}

/**
 * Split chapter `index` so a new chapter titled `title` starts at `page`. Sections
 * from `page` on move to the new chapter. The old chapter ends on the page before,
 * unless both share the page (a chapter may start mid-page where the last one ends).
 */
export function split(outline: Outline, index: number, page: number, title: string): Outline {
  const ch = outline[index];
  if (!ch || page <= ch.page_from || page > ch.page_to) return outline;
  const keep = ch.sections.filter((s) => s.page_from < page);
  const move = ch.sections.filter((s) => s.page_from >= page);
  const first: OutlineChapter = { ...ch, page_to: page - 1, sections: keep };
  const second: OutlineChapter = { title, page_from: page, page_to: ch.page_to, sections: move };
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

/** Trimmed titles, ready to send. */
export function toPayload(outline: Outline): { chapters: Outline } {
  return {
    chapters: outline.map((c) => ({
      ...c,
      title: c.title.trim(),
      sections: c.sections.map((s) => ({ ...s, title: s.title.trim() })),
    })),
  };
}

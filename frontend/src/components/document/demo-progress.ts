/**
 * The document page in the read-only demo (docs/DEMO.md): the page is rendered once for
 * every visitor (and cached), but a visitor's own progress is kept in their browser
 * (lib/documents/local-reading.ts). This puts it back on the page: the browser's positions
 * are merged over the rendered ones, and the reading block (the continue link, how much is
 * read, the chapter strip) is brought up to date in place, with the page's own functions.
 */
import { anchorLabel } from '../../lib/anchors';
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import { localReading, mergePositions } from '../../lib/documents/local-reading';
import { bookProgress, continueTarget, percent, positionsByUnit } from '../../lib/documents/reading';
import { defaultUnit } from '../../lib/documents/tree';
import { inCollection } from '../collections/path';
import { plural } from '../library/spine';
import { stripSegments } from './chapter-strip';

export interface ReadingBlockData {
  slug: string;
  units: TreeNode[];
  reading: ReadingPosition[];
  collection: string | null;
}

const unitName = (unit: TreeNode) => [unit.meta.front_matter ? null : anchorLabel(unit.anchor), unit.heading].filter(Boolean).join(' · ');

/** An element styled like `like` (Astro scopes a page's styles with a `data-astro-cid-*`). */
function element<K extends keyof HTMLElementTagNameMap>(like: Element, tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const el = like.ownerDocument.createElement(tag);
  for (const attr of Array.from(like.attributes)) if (attr.name.startsWith('data-astro-cid')) el.setAttribute(attr.name, attr.value);
  if (className) el.className = className;
  el.textContent = text;
  return el;
}

export function showLocalProgress(root: ParentNode, data: ReadingBlockData, local: readonly ReadingPosition[] = localReading(data.slug).positions): void {
  if (local.length === 0) return;
  const { slug, units, collection } = data;
  const reading = mergePositions(data.reading, local);
  const positions = positionsByUnit(reading, units);
  const resume = continueTarget(reading, units);
  const book = bookProgress(reading, units);
  const readAt = (anchor: string) => inCollection(`/documents/${slug}/read/${anchor}`, collection);

  const link = root.querySelector<HTMLAnchorElement>('.primary-actions a.read');
  const first = defaultUnit(units);
  if (link && (resume || first)) {
    if (resume) {
      link.href = readAt(resume.anchor);
      const where = `${unitName(resume.unit)}${resume.progress > 0 ? `, ${percent(resume.progress)}%` : ''}`;
      link.replaceChildren(element(link, 'span', resume.kind === 'continue' ? 'Continue reading' : 'Read the next chapter'), element(link, 'span', where, 'read-where'));
    } else if (first) {
      link.href = readAt(first.anchor);
      link.replaceChildren('Read again');
    }
  }

  const summary = root.querySelector('.book-progress');
  if (summary) {
    summary.replaceChildren(element(summary, 'strong', `${percent(book.progress)}% read`), element(summary, 'span', `${book.finished} of ${plural(book.total, 'chapter')} finished`));
  }

  const strip = root.querySelector<HTMLElement>('.strip');
  const items = strip ? Array.from(strip.querySelectorAll('li')) : [];
  const segments = stripSegments(slug, units, positions, resume?.unit.anchor ?? null, collection);
  if (!strip || items.length !== segments.length) return;
  strip.dataset.progress = String(percent(book.progress));
  segments.forEach((s, i) => {
    const li = items[i];
    const a = li?.querySelector('a');
    if (!li || !a) return;
    li.toggleAttribute('data-current', s.current);
    li.toggleAttribute('data-finished', s.finished);
    a.href = s.href;
    a.title = `${s.title}${s.progress > 0 ? `, ${percent(s.progress)}% read` : ''}`;
    const fill = a.querySelector<HTMLElement>('[aria-hidden="true"]');
    if (fill) fill.style.inlineSize = `${Math.round(s.progress * 100)}%`;
    const hidden = a.querySelector('.visually-hidden');
    if (hidden) hidden.textContent = `${s.title}${s.finished ? ', read' : s.progress > 0 ? `, ${percent(s.progress)}% read` : ''}${s.current ? ', you are here' : ''}`;
  });
}

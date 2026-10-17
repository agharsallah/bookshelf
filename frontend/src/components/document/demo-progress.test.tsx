import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import { ChapterStrip } from './ChapterStrip';
import { showLocalProgress } from './demo-progress';

const unit = (anchor: string, from: number, to: number) => ({ anchor, heading: `Heading ${anchor}`, page_from: from, page_to: to, meta: {}, children: [] }) as unknown as TreeNode;
const at = (unit: string, anchor: string, progress: number, updated_at = '2026-10-17T10:00:00Z'): ReadingPosition => ({ unit, anchor, progress, updated_at });
const units = [unit('ch01', 1, 10), unit('ch02', 11, 20)];

/** The reading block as the page renders it before anything is read. */
function page(): HTMLElement {
  document.body.innerHTML = `
    <div class="reading">
      <div class="primary-actions"><a class="read" data-astro-cid-x href="/documents/m/read/ch01">Start reading</a>
      <p class="book-progress" data-astro-cid-x><span>Not started yet</span></p></div>
      <div class="strip">${renderToStaticMarkup(<ChapterStrip slug="m" units={units} positions={{}} />)}</div>
    </div>`;
  return document.body;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('showLocalProgress', () => {
  it("puts the browser's progress on the rendered page", () => {
    const root = page();
    showLocalProgress(root, { slug: 'm', units, reading: [], collection: null }, [at('ch01', 'ch01/p9', 1), at('ch02', 'ch02/p3', 0.5, '2026-10-17T11:00:00Z')]);

    const link = root.querySelector('a.read') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/documents/m/read/ch02/p3');
    expect(Array.from(link.children).map((c) => c.textContent)).toEqual(['Continue reading', '2 · Heading ch02, 50%']);
    expect(link.querySelector('.read-where')?.hasAttribute('data-astro-cid-x')).toBe(true);
    expect(root.querySelector('.book-progress')?.textContent).toBe('75% read1 of 2 chapters finished');

    const [first, second] = Array.from(root.querySelectorAll('.strip li'));
    expect(first?.hasAttribute('data-finished')).toBe(true);
    expect(second?.hasAttribute('data-current')).toBe(true);
    expect(second?.querySelector<HTMLElement>('[aria-hidden="true"]')?.style.inlineSize).toBe('50%');
  });

  it('leaves the page alone when nothing is kept in the browser', () => {
    const root = page();
    const before = root.innerHTML;
    showLocalProgress(root, { slug: 'm', units, reading: [], collection: null }, []);
    expect(root.innerHTML).toBe(before);
  });
});

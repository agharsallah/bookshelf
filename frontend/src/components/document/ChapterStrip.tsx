/**
 * The book as a strip of chapters (chapter-strip.ts): widths by pages, ink for what
 * you have read, the highlighter on the chapter you are in. Each segment opens the
 * reader there. Static markup: it renders on the server and needs no hydration.
 */
import type { ReadingPosition, TreeNode } from '../../lib/api/types/documents';
import { percent } from '../../lib/documents/reading';
import { stripSegments } from './chapter-strip';
import styles from './ChapterStrip.module.css';

export interface ChapterStripProps {
  slug: string;
  units: TreeNode[];
  positions: Record<string, ReadingPosition>;
  /** The chapter to mark as where you are. */
  current?: string | null;
  size?: 'sm' | 'lg';
  label?: string;
  /** The collection the page was reached from, kept in each reader link. */
  collection?: string | null;
}

export function ChapterStrip({ slug, units, positions, current = null, size = 'sm', label = 'Chapters and how far you have read them', collection = null }: ChapterStripProps) {
  const segments = stripSegments(slug, units, positions, current, collection);
  if (segments.length === 0) return null;
  return (
    <ol className={styles.strip} data-size={size} aria-label={label}>
      {segments.map((s) => (
        <li
          key={s.anchor}
          className={styles.segment}
          style={{ flexGrow: s.share }}
          data-current={s.current ? '' : undefined}
          data-front={s.front ? '' : undefined}
          data-finished={s.finished ? '' : undefined}
        >
          <a href={s.href} title={`${s.title}${s.progress > 0 ? `, ${percent(s.progress)}% read` : ''}`}>
            <span className={styles.fill} style={{ inlineSize: `${Math.round(s.progress * 100)}%` }} aria-hidden="true" />
            <span className="visually-hidden">
              {s.title}
              {s.finished ? ', read' : s.progress > 0 ? `, ${percent(s.progress)}% read` : ''}
              {s.current ? ', you are here' : ''}
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

export default ChapterStrip;

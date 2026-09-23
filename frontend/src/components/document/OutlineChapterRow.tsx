/**
 * One chapter in the outline editor: title, page range (the last page may be left
 * blank: the chapter then runs to the next one), whether it is distilled, its sections
 * and the edit actions.
 */
import { useState } from 'react';
import type { OutlineChapter } from '../../lib/api/types/documents';
import styles from './OutlineEditor.module.css';

export interface ChapterRowProps {
  index: number;
  chapter: OutlineChapter;
  isLast: boolean;
  invalid: boolean;
  /** The last page to assume when `page_to` is blank (next chapter, or the document's end). */
  end: number | null;
  onTitle: (title: string) => void;
  onPages: (pages: { page_from?: number; page_to?: number | null }) => void;
  onSkip: (skip: boolean) => void;
  onMerge: () => void;
  onSplit: (page: number, title: string) => void;
  onRemove: () => void;
  onAddSection: () => void;
  onSection: (at: number, change: { title?: string; page_from?: number }) => void;
  onRemoveSection: (at: number) => void;
}

const num = (value: string) => (value === '' ? 0 : Math.trunc(Number(value)));
const optionalNum = (value: string) => (value.trim() === '' ? null : Math.trunc(Number(value)));

export function ChapterRow(props: ChapterRowProps) {
  const { index, chapter, isLast, invalid, end } = props;
  const [splitting, setSplitting] = useState<{ page: string; title: string } | null>(null);
  const id = `outline-ch-${index}`;
  const last = chapter.page_to ?? end;
  const splitPage = splitting ? num(splitting.page) : 0;
  const canSplit = splitting !== null && splitPage > chapter.page_from && (last === null || splitPage <= last) && splitting.title.trim() !== '';

  return (
    <li className={styles.chapter} data-invalid={invalid ? '' : undefined} data-skip={chapter.skip ? '' : undefined}>
      <div className={styles.chapterRow}>
        <span className={styles.index} aria-hidden="true">
          {index + 1}
        </span>
        <label className={styles.titleField}>
          <span className="visually-hidden">Chapter {index + 1} title</span>
          <input id={id} value={chapter.title} onChange={(e) => props.onTitle(e.target.value)} maxLength={500} />
        </label>
        <label className={styles.pageField}>
          <span>from p.</span>
          <input
            type="number"
            min={1}
            value={chapter.page_from}
            onChange={(e) => props.onPages({ page_from: num(e.target.value) })}
            aria-label={`Chapter ${index + 1} first page`}
          />
        </label>
        <label className={styles.pageField}>
          <span>to</span>
          <input
            type="number"
            min={1}
            value={chapter.page_to ?? ''}
            placeholder={end !== null ? String(end) : 'end'}
            onChange={(e) => props.onPages({ page_to: optionalNum(e.target.value) })}
            aria-label={`Chapter ${index + 1} last page (blank: until the next chapter)`}
          />
        </label>
        <label className={styles.skipField}>
          <input type="checkbox" checked={chapter.skip ?? false} onChange={(e) => props.onSkip(e.target.checked)} />
          <span>Skip</span>
          <span className="visually-hidden"> chapter {index + 1} when distilling</span>
        </label>
      </div>

      <div className={styles.rowActions}>
        <button type="button" onClick={() => setSplitting(splitting ? null : { page: String(chapter.page_from + 1), title: '' })}>
          Split
        </button>
        {!isLast ? (
          <button type="button" onClick={props.onMerge}>
            Merge with next
          </button>
        ) : null}
        <button type="button" onClick={props.onAddSection}>
          Add section
        </button>
        <button type="button" className={styles.danger} onClick={props.onRemove}>
          Remove
        </button>
      </div>

      {splitting ? (
        <div className={styles.split}>
          <label>
            <span>New chapter starts on page</span>
            <input
              type="number"
              min={chapter.page_from + 1}
              max={last ?? undefined}
              value={splitting.page}
              onChange={(e) => setSplitting({ ...splitting, page: e.target.value })}
            />
          </label>
          <label>
            <span>Its title</span>
            <input value={splitting.title} onChange={(e) => setSplitting({ ...splitting, title: e.target.value })} autoFocus />
          </label>
          <button
            type="button"
            disabled={!canSplit}
            onClick={() => {
              props.onSplit(splitPage, splitting.title.trim());
              setSplitting(null);
            }}
          >
            Split here
          </button>
        </div>
      ) : null}

      {chapter.sections.length > 0 ? (
        <ol className={styles.sections}>
          {chapter.sections.map((section, at) => (
            <li key={at} className={styles.sectionRow}>
              <label className={styles.titleField}>
                <span className="visually-hidden">Section title</span>
                <input value={section.title} onChange={(e) => props.onSection(at, { title: e.target.value })} maxLength={500} />
              </label>
              <label className={styles.pageField}>
                <span>p.</span>
                <input
                  type="number"
                  min={chapter.page_from}
                  max={last ?? undefined}
                  value={section.page_from}
                  onChange={(e) => props.onSection(at, { page_from: num(e.target.value) })}
                  aria-label={`${section.title || 'Section'} first page`}
                />
              </label>
              <button
                type="button"
                className={styles.danger}
                onClick={() => props.onRemoveSection(at)}
                aria-label={`Remove section ${section.title}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

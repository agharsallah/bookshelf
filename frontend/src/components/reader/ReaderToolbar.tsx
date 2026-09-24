/**
 * The reader's sticky toolbar: book and chapter, the pane controls, the "Aa"
 * reading settings and chapter navigation. Popovers (contents, settings) hang from
 * it; the reader owns their state.
 */
import type { ReactNode, RefObject } from 'react';
import { TypeIcon } from './icons';
import type { NavUnit } from './Navigator';
import styles from './Reader.module.css';

export type ReaderView = 'source' | 'distil';

export interface ReaderToolbarProps {
  book: { title: string; href: string };
  chapter: string;
  prev: NavUnit | null;
  next: NavUnit | null;
  readHref: (anchor: string) => string;
  view: ReaderView;
  onView: (view: ReaderView) => void;
  locked: boolean;
  onLock: () => void;
  contents: { open: boolean; onToggle: () => void; button: RefObject<HTMLButtonElement | null>; popover: ReactNode };
  settings: { open: boolean; onToggle: () => void; button: RefObject<HTMLButtonElement | null>; panel: ReactNode };
}

export function ReaderToolbar({ book, chapter, prev, next, readHref, view, onView, locked, onLock, contents, settings }: ReaderToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.titles}>
        <a className={styles.book} href={book.href}>
          {book.title}
        </a>
        <h1 className={styles.chapter}>{chapter}</h1>
      </div>
      <div className={styles.controls}>
        <button ref={contents.button} type="button" className={styles.contentsButton} aria-expanded={contents.open} onClick={contents.onToggle}>
          Contents
        </button>
        <div className={styles.viewSwitch} role="group" aria-label="Show">
          <button type="button" aria-pressed={view === 'source'} onClick={() => onView('source')}>
            Text
          </button>
          <button type="button" aria-pressed={view === 'distil'} onClick={() => onView('distil')}>
            Distillation
          </button>
        </div>
        <button type="button" className={styles.lock} aria-pressed={locked} onClick={onLock} title="Keep the right pane where it is while you scroll">
          {locked ? 'Unlock pane' : 'Lock pane'}
        </button>
        <button
          ref={settings.button}
          type="button"
          className={styles.icon}
          aria-expanded={settings.open}
          aria-label="Reading settings"
          title="Reading settings: font, size, spacing"
          onClick={settings.onToggle}
        >
          <TypeIcon />
        </button>
        <span className={styles.chapterNav}>
          {prev ? <a href={readHref(prev.anchor)} aria-label={`Previous chapter: ${prev.heading}`} title="Previous chapter ([)">‹</a> : null}
          {next ? <a href={readHref(next.anchor)} aria-label={`Next chapter: ${next.heading}`} title="Next chapter (])">›</a> : null}
        </span>
      </div>
      {contents.open ? <div className={styles.contentsPopover}>{contents.popover}</div> : null}
      {settings.open ? settings.panel : null}
    </div>
  );
}

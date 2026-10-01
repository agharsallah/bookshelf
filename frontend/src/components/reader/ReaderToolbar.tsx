/**
 * The reader's sticky toolbar: book and chapter, the pane toggles, the "Aa"
 * reading settings, listening, focus mode, full screen and chapter navigation. Popovers
 * (contents, settings) hang from it; the reader owns their state. In focus mode it
 * slides away while you read (`hidden`).
 */
import type { ReactNode, RefObject } from 'react';
import type { CSSProperties } from 'react';
import { CollapseIcon, ContentsIcon, ExpandIcon, FocusIcon, KeyboardIcon, ListenIcon, PaneIcon, TypeIcon } from './icons';
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
  layout: {
    rail: boolean;
    pane: boolean;
    focus: boolean;
    onRail: () => void;
    onPane: () => void;
    onFocus: () => void;
    fullscreen: { active: boolean; supported: boolean; toggle: () => void };
  };
  /** The chapter read aloud (ChapterListen): whether its player is open; null hides it (continuous reading). */
  listen: { open: boolean; onToggle: () => void } | null;
  hidden: boolean;
  /** 0–1 through the chapter, drawn along the toolbar's lower edge (still visible when it is tucked away). */
  progress: number;
  timeLeft: string;
  onHelp: () => void;
  /** A document-specific control at the head of the controls (a paper's passes). */
  extra?: ReactNode;
}

export function ReaderToolbar(props: ReaderToolbarProps) {
  const { book, chapter, prev, next, readHref, view, onView, locked, onLock, contents, settings, listen, layout, hidden, progress, timeLeft, onHelp, extra } = props;
  const { fullscreen } = layout;
  return (
    <div className={styles.toolbar} data-hidden={hidden ? '' : undefined}>
      <div className={styles.titles}>
        <span className={styles.bookLine}>
          <a className={styles.book} href={book.href}>
            {book.title}
          </a>
          <span className={styles.timeLeft}>{timeLeft}</span>
        </span>
        <h1 className={styles.chapter}>{chapter}</h1>
      </div>
      <div className={styles.controls}>
        {extra}
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
        <span className={styles.panelToggles}>
          <button type="button" className={`${styles.icon} ${styles.railToggle}`} aria-pressed={layout.rail} aria-label="Contents rail" title="Show or hide the contents (t)" onClick={layout.onRail}>
            <ContentsIcon />
          </button>
          <button type="button" className={`${styles.icon} ${styles.paneToggle}`} aria-pressed={layout.pane} aria-label="Distillation pane" title="Show or hide the distillation (d)" onClick={layout.onPane}>
            <PaneIcon />
          </button>
        </span>
        <button type="button" className={styles.lock} aria-pressed={locked} onClick={onLock} title="Make the right pane follow your reading position as you scroll">
          {locked ? 'Follow reading' : 'Stop following'}
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
        {listen ? (
          <button type="button" className={styles.icon} aria-pressed={listen.open} aria-label="Listen" title="Listen: the chapter read aloud (l)" onClick={listen.onToggle}>
            <ListenIcon />
          </button>
        ) : null}
        <button type="button" className={styles.icon} aria-pressed={layout.focus} aria-label="Focus mode" title="Focus mode: just the text (f)" onClick={layout.onFocus}>
          <FocusIcon />
        </button>
        {fullscreen.supported ? (
          <button type="button" className={styles.icon} aria-pressed={fullscreen.active} aria-label="Full screen" title="Full screen (⇧F)" onClick={fullscreen.toggle}>
            {fullscreen.active ? <CollapseIcon /> : <ExpandIcon />}
          </button>
        ) : null}
        <button type="button" className={`${styles.icon} ${styles.helpButton}`} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={onHelp}>
          <KeyboardIcon />
        </button>
        <span className={styles.chapterNav}>
          {prev ? <a href={readHref(prev.anchor)} data-astro-prefetch="hover" aria-label={`Previous chapter: ${prev.heading}`} title="Previous chapter ([)">‹</a> : null}
          {next ? <a href={readHref(next.anchor)} data-astro-prefetch="hover" aria-label={`Next chapter: ${next.heading}`} title="Next chapter (])">›</a> : null}
        </span>
      </div>
      <span className={styles.progressLine} aria-hidden="true" style={{ '--progress': progress } as CSSProperties} />
      {contents.open ? <div className={styles.contentsPopover}>{contents.popover}</div> : null}
      {settings.open ? settings.panel : null}
    </div>
  );
}

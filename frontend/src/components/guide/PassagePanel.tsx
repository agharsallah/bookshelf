/**
 * The cited passage, in place: a drawer that opens the whole chapter beside the guide,
 * scrolled to the cited block and marked, so a claim can be checked without leaving
 * the page. Previous / next browse on through the book; "Open in reader" goes to the
 * full reader at the same passage. Figures open in the shared lightbox. Its left edge
 * drags wider or narrower (the reader's MeasureHandle), and its width and typography
 * are the reader's saved preferences, so the text reads the same in both places.
 *
 * A modal <dialog>: Escape or the backdrop closes it, focus stays inside, and it
 * hands focus back to the cite that opened it.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { pageMarkers } from '../../lib/documents/tree';
import { toast } from '../document/toast';
import { revealBlock, sourceBlock } from '../reader/dom';
import { figureItems } from '../reader/figures';
import { MeasureHandle } from '../reader/MeasureHandle';
import { prefsVars } from '../reader/prefs';
import { SourceBlock } from '../reader/SourceBlock';
import { useFigureLightbox } from '../reader/useFigureLightbox';
import { useReaderPrefs } from '../reader/usePrefs';
import { loadChapter, neighbours, sectionHeading, targetBlock, type LoadedChapter, type PassageUnit } from './passage';
import styles from './PassagePanel.module.css';

export interface PassageTarget {
  unit: PassageUnit;
  /** The cited anchor; the chapter's own anchor opens it at the top. */
  anchor: string;
}

export interface PassagePanelProps {
  slug: string;
  units: readonly PassageUnit[];
  target: PassageTarget;
  onTarget: (target: PassageTarget) => void;
  onClose: () => void;
  readHref: (anchor: string) => string;
}

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; chapter: LoadedChapter };

const NO_MARKS: never[] = [];

/** The drawer's width until it is dragged (46rem), px. */
export const PASSAGE_WIDTH = 736;

export function PassagePanel({ slug, units, target, onTarget, onClose, readHref }: PassagePanelProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const { unit, anchor } = target;
  const chapter = load.status === 'ready' ? load.chapter : null;
  const flat = useMemo(() => chapter?.flat ?? [], [chapter]);
  const pages = useMemo(() => pageMarkers(flat), [flat]);
  const cited = anchor === unit.anchor ? null : targetBlock(flat, anchor);
  const section = cited ? sectionHeading(flat, cited) : null;
  const { previous, next } = neighbours(units, unit);
  const [prefs, setPrefs] = useReaderPrefs();
  const width = prefs.passage ?? PASSAGE_WIDTH;
  const style = { ...prefsVars(prefs), '--passage-width': `${width}px` } as CSSProperties;

  // Open as a modal; hand focus back to the opener on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = dialog.current;
    if (el && !el.open) el.showModal?.();
    return () => opener?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let live = true;
    setLoad({ status: 'loading' });
    loadChapter(slug, unit.anchor).then(
      (loaded) => live && setLoad({ status: 'ready', chapter: loaded }),
      () => live && setLoad({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [slug, unit.anchor, attempt]);

  const reveal = useCallback((to: string) => {
    const root = body.current;
    if (!root) return;
    for (const el of root.querySelectorAll('[data-cited]')) el.removeAttribute('data-cited');
    sourceBlock(root, to)?.setAttribute('data-cited', '');
    revealBlock(root, to);
  }, []);

  // Once the chapter is on screen: to the cited block, or the top for a whole chapter.
  useEffect(() => {
    if (!chapter) return;
    if (cited) requestAnimationFrame(() => reveal(cited));
    else body.current?.scrollTo({ top: 0 });
  }, [chapter, cited, reveal]);

  const figures = useMemo(() => figureItems(flat.map((f) => f.node)), [flat]);
  const { openFigure, open: lightboxOpen, lightbox } = useFigureLightbox(figures, reveal);

  const onBodyClick = (event: MouseEvent<HTMLDivElement>) => {
    const el = event.target instanceof Element ? event.target : null;
    const magnify = el?.closest<HTMLElement>('[data-magnify]');
    if (magnify?.dataset.magnify) {
      openFigure(magnify.dataset.magnify);
      return;
    }
    const copy = el?.closest<HTMLElement>('[data-copy-anchor]');
    if (copy?.dataset.copyAnchor) {
      const url = new URL(readHref(copy.dataset.copyAnchor), window.location.href).href;
      void navigator.clipboard?.writeText(url).then(
        () => toast('Link to the passage copied.', 'good'),
        () => toast('Could not copy the link.', 'bad'),
      );
    }
  };

  // The backdrop is the dialog itself: a click on it (not its panel) closes — but only one
  // that also started there, so a width drag released past the edge never closes it.
  const pressedBackdrop = useRef(false);
  const onDialogPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = event.target === dialog.current;
  };
  const onDialogClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (pressedBackdrop.current && event.target === dialog.current) dialog.current?.close();
    pressedBackdrop.current = false;
  };

  const go = (to: PassageUnit | null) => to && onTarget({ unit: to, anchor: to.anchor });

  return (
    <dialog
      ref={dialog}
      className={styles.panel}
      style={style}
      aria-labelledby={titleId}
      onClose={onClose}
      onPointerDown={onDialogPointerDown}
      onClick={onDialogClick}
      // While the lightbox is up, Escape is its to handle.
      onCancel={(event) => lightboxOpen && event.preventDefault()}
    >
      <div className={styles.sheet}>
        <header className={styles.head}>
          <p className={styles.kicker}>
            Chapter {unit.label}
            {section ? <span className={styles.section}> · {section}</span> : null}
          </p>
          <h2 id={titleId} className={styles.title}>
            {unit.heading}
          </h2>
          <div className={styles.actions}>
            {cited ? (
              <button type="button" className={styles.action} onClick={() => reveal(cited)}>
                Back to the cited passage
              </button>
            ) : null}
            <a className={styles.action} href={readHref(anchor)}>
              Open in reader
            </a>
            <button type="button" className={styles.close} aria-label="Close the passage" onClick={() => dialog.current?.close()}>
              ✕
            </button>
          </div>
        </header>

        <div ref={body} className={styles.body} onClick={onBodyClick} aria-busy={load.status === 'loading'}>
          {load.status === 'loading' ? (
            <div className={styles.skeleton} aria-label="Loading the chapter">
              {Array.from({ length: 6 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
          ) : load.status === 'error' ? (
            <div className={styles.problem} role="alert">
              <p>The chapter could not be loaded.</p>
              <p>
                <button type="button" className={styles.action} onClick={() => setAttempt((n) => n + 1)}>
                  Try again
                </button>{' '}
                or <a href={readHref(anchor)}>open it in the reader</a>.
              </p>
            </div>
          ) : (
            <>
              {load.chapter.truncated ? <p className={styles.notice}>This chapter is very long; only its first 2,000 blocks are shown.</p> : null}
              {flat.length === 0 ? <p className={styles.notice}>This chapter has no text blocks.</p> : null}
              {flat.map(({ node }, i) => (
                <SourceBlock key={node.anchor} node={node} marks={NO_MARKS} page={pages[i] ?? null} hasBlockNote={false} level={node.depth - load.chapter.unit.depth} />
              ))}
            </>
          )}
        </div>

        <nav className={styles.foot} aria-label="Chapters">
          {previous ? (
            <button type="button" className={styles.step} onClick={() => go(previous)}>
              <span aria-hidden="true">←</span> {previous.label}. {previous.heading}
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button type="button" className={`${styles.step} ${styles.stepNext}`} onClick={() => go(next)}>
              {next.label}. {next.heading} <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </nav>
      </div>
      <MeasureHandle
        column={dialog}
        root={dialog}
        anchor="end"
        property="--passage-width"
        label="Passage width"
        width={width}
        onChange={(passage) => setPrefs({ passage })}
      />
      {lightbox}
    </dialog>
  );
}

export default PassagePanel;

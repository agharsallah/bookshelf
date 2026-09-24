/**
 * The figure lightbox: one figure at a time on a dark stage, fitted to the
 * screen, with zoom (wheel, pinch, double click, + / −), pan (drag, arrows),
 * the figure's caption and page, "Show in text" back to its passage, and — when
 * the chapter has several — previous / next and a strip of thumbnails.
 *
 * A modal <dialog>: Escape closes it, focus stays inside, and it hands focus
 * back to whatever opened it. Keys pressed here never reach the page behind.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { usePanZoom } from './usePanZoom';
import type { Size } from './zoom';
import styles from './Lightbox.module.css';

interface ItemBase {
  id: string;
  /** The caption, or a stand-in ("Figure"). */
  title: string;
  /** A short line under it: "Page 96 · 10.3". */
  meta?: string | undefined;
  alt: string;
  /** Source anchor, for "Show in text". */
  anchor?: string | undefined;
}

export type LightboxItem = ItemBase & ({ kind: 'image'; src: string } | { kind: 'svg'; html: string });

export interface LightboxProps {
  items: readonly LightboxItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onReveal?: ((anchor: string) => void) | undefined;
}

const STEP = 1.4;
const PAN = 80;

/** The natural size of an inline SVG: its viewBox, else its rendered box. */
function svgSize(host: HTMLElement): Size | null {
  const svg = host.querySelector('svg');
  if (!svg) return null;
  const box = svg.viewBox?.baseVal;
  const rect = svg.getBoundingClientRect();
  const size = box && box.width > 0 ? { width: box.width, height: box.height } : { width: rect.width, height: rect.height };
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  svg.style.maxWidth = 'none';
  return size.width > 0 ? size : null;
}

export function Lightbox({ items, index, onIndex, onClose, onReveal }: LightboxProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgHost = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const item = items[index];
  const [natural, setNatural] = useState<{ id: string; size: Size } | null>(null);
  const [hint, setHint] = useState(true);
  const size = natural && natural.id === item?.id ? natural.size : null;
  const zoom = usePanZoom(stageRef, size, item?.id ?? '', onClose);

  // Open as a modal; give focus back to the opener when unmounted.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = dialog.current;
    if (el && !el.open) el.showModal?.();
    // Keys must land in here even where showModal leaves focus behind.
    if (el && !el.contains(document.activeElement)) el.focus();
    const timer = window.setTimeout(() => setHint(false), 2600);
    return () => {
      window.clearTimeout(timer);
      opener?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    if (item?.kind === 'svg' && svgHost.current) {
      const measured = svgSize(svgHost.current);
      if (measured) setNatural({ id: item.id, size: measured });
    }
  }, [item]);

  if (!item) return null;
  const many = items.length > 1;
  const go = (step: number) => onIndex((index + step + items.length) % items.length);
  const percent = Math.round(zoom.view.scale * 100);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    // The reader's single-key shortcuts listen on the document: keep keys in here.
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [PAN, 0], ArrowRight: [-PAN, 0], ArrowUp: [0, PAN], ArrowDown: [0, -PAN] };
    const key = event.key;
    let handled = true;
    if (key === '+' || key === '=') zoom.zoomBy(STEP);
    else if (key === '-' || key === '_') zoom.zoomBy(1 / STEP);
    else if (key === '0') zoom.fit();
    else if (key === '1') zoom.actualSize();
    else if (arrows[key] && zoom.zoomed) zoom.pan(...arrows[key]);
    else if ((key === 'ArrowLeft' || key === 'ArrowRight') && many) go(key === 'ArrowLeft' ? -1 : 1);
    else handled = false;
    if (handled) event.preventDefault();
  };

  const transform = `translate(-50%, -50%) translate(${zoom.view.x}px, ${zoom.view.y}px) scale(${zoom.view.scale})`;

  return (
    <dialog
      ref={dialog}
      className={styles.lightbox}
      aria-labelledby={titleId}
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <header className={styles.bar}>
        <div className={styles.heading}>
          <h2 id={titleId} className={styles.title}>
            {item.title}
          </h2>
          <p className={styles.meta}>
            {many ? (
              <span>
                {index + 1} of {items.length}
              </span>
            ) : null}
            {item.meta ? <span>{item.meta}</span> : null}
          </p>
        </div>
        <div className={styles.tools} role="toolbar" aria-label="Zoom">
          <button type="button" className={styles.tool} aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoom.zoomBy(1 / STEP)}>
            −
          </button>
          <button type="button" className={`${styles.tool} ${styles.percent}`} aria-label={`Zoom ${percent}%, fit to screen`} title="Fit to screen (0)" onClick={zoom.fit}>
            {percent}%
          </button>
          <button type="button" className={styles.tool} aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom.zoomBy(STEP)}>
            +
          </button>
          <button type="button" className={styles.tool} aria-pressed={Math.abs(zoom.view.scale - 1) < 0.01} title="Actual size (1)" onClick={zoom.actualSize}>
            1:1
          </button>
          {item.anchor && onReveal ? (
            <button type="button" className={`${styles.tool} ${styles.wide}`} onClick={() => onReveal(item.anchor ?? '')}>
              Show in text
            </button>
          ) : null}
          {item.kind === 'image' ? (
            <a className={`${styles.tool} ${styles.wide}`} href={item.src} target="_blank" rel="noopener">
              Open original
            </a>
          ) : null}
          <button type="button" className={`${styles.tool} ${styles.close}`} aria-label="Close" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className={styles.stage}
        data-zoomed={zoom.zoomed ? '' : undefined}
        data-live={zoom.live ? '' : undefined}
      >
        <div
          className={styles.frame}
          data-kind={item.kind}
          data-ready={size ? '' : undefined}
          style={{ width: size?.width, height: size?.height, transform }}
        >
          {item.kind === 'image' ? (
            <img
              key={item.id}
              className={styles.image}
              src={item.src}
              alt={item.alt}
              draggable={false}
              onLoad={(e) => setNatural({ id: item.id, size: { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight } })}
            />
          ) : (
            <div key={item.id} ref={svgHost} className={styles.svg} role="img" aria-label={item.alt} dangerouslySetInnerHTML={{ __html: item.html }} />
          )}
        </div>
        {many ? (
          <>
            <button type="button" className={`${styles.nav} ${styles.prev}`} aria-label="Previous figure" title="Previous (←)" onClick={() => go(-1)}>
              ‹
            </button>
            <button type="button" className={`${styles.nav} ${styles.next}`} aria-label="Next figure" title="Next (→)" onClick={() => go(1)}>
              ›
            </button>
          </>
        ) : null}
        <p className={styles.hint} data-hidden={hint ? undefined : ''} aria-hidden="true">
          Scroll or pinch to zoom · drag to pan · double-click to toggle
        </p>
      </div>

      {many ? (
        <nav className={styles.strip} aria-label="Figures in this chapter">
          {items.map((it, i) => (
            <button key={it.id} type="button" className={styles.thumb} aria-current={i === index ? 'true' : undefined} aria-label={`${i + 1}: ${it.title}`} onClick={() => onIndex(i)}>
              {it.kind === 'image' ? <img src={it.src} alt="" loading="lazy" draggable={false} /> : <span aria-hidden="true">◇</span>}
            </button>
          ))}
        </nav>
      ) : null}
    </dialog>
  );
}

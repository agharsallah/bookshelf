/**
 * The card a marked passage opens: what it is (core idea, key point, a term), why it
 * was marked, the term's definition, and two ways on: keep it as your own highlight,
 * or go to the next key idea. Closes on Escape or a click elsewhere.
 */
import { useEffect, useRef } from 'react';
import type { Salient } from './salience';
import styles from './Salience.module.css';

export interface SalienceCardProps {
  salient: Salient;
  /** The click that opened it, in viewport px. */
  x: number;
  y: number;
  /** Already saved as one of your highlights (this visit). */
  kept: boolean;
  saving: boolean;
  onKeep: () => void;
  onNext: () => void;
  onClose: () => void;
}

const SOURCE_LABELS: Record<Salient['source'], string> = {
  model: 'Chosen by Claude for this chapter',
  heuristic: 'Inferred from what the notes cite',
  recall: 'From your last recall of this chapter',
};

const WIDTH = 320;
const GAP = 12;

export function SalienceCard({ salient, x, y, kept, saving, onKeep, onNext, onClose }: SalienceCardProps) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    card.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !card.current?.contains(event.target)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    // Registered after the opening click has finished, so it does not close the card at once.
    const id = setTimeout(() => document.addEventListener('pointerdown', onPointer));
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(id);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const left = Math.max(GAP, Math.min(x - WIDTH / 2, (typeof window === 'undefined' ? 1024 : window.innerWidth) - WIDTH - GAP));
  const below = typeof window === 'undefined' || y < window.innerHeight * 0.6;
  const position = below ? { top: y + GAP } : { bottom: window.innerHeight - y + GAP };

  return (
    <div
      ref={card}
      className={styles.card}
      data-tier={salient.tier}
      data-flip={below ? undefined : ''}
      role="dialog"
      aria-label={salient.title}
      style={{ left, width: WIDTH, ...position }}
    >
      <p className={styles.cardTier}>{salient.tier === 'term' ? 'Term' : salient.title}</p>
      {salient.tier === 'term' ? <p className={styles.cardTitle}>{salient.title}</p> : null}
      {salient.gloss ? <p className={styles.cardGloss}>{salient.gloss}</p> : null}
      {salient.why ? <p className={styles.cardWhy}>{salient.why}</p> : null}
      <p className={styles.cardSource}>{SOURCE_LABELS[salient.source]}</p>
      <div className={styles.cardActions}>
        {kept ? (
          <span className={styles.kept}>In your highlights</span>
        ) : (
          <button type="button" onClick={onKeep} disabled={saving}>
            {saving ? 'Keeping…' : 'Keep as highlight'}
          </button>
        )}
        <button type="button" onClick={onNext}>
          Next key idea →
        </button>
      </div>
    </div>
  );
}

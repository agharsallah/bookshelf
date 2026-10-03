/**
 * A burst of colour for a big win, in the playful tone only, and never when the reader
 * asked for less motion. A plain DOM utility like `toast`: any island calls `burst()`,
 * which drops a few dozen falling pieces and removes them when they land.
 */
import { cheerTone } from './prefs';
import styles from './burst.module.css';

const PIECES = 36;
const LIFETIME_MS = 1600;
const COLORS = ['var(--marker)', 'var(--accent)', 'var(--tone-insight)', 'var(--tone-caution)', 'var(--tone-important)', 'var(--tone-question)'];

const reducedMotion = (win: Window) => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

export function wantsBurst(win: Window = window): boolean {
  return cheerTone(win.document) === 'playful' && !reducedMotion(win);
}

/** Returns whether it ran. `force` skips the tone (never reduced motion); `random` is for tests. */
export function burst(win: Window = window, random: () => number = Math.random, { force = false } = {}): boolean {
  if (force ? reducedMotion(win) : !wantsBurst(win)) return false;
  const doc = win.document;
  const layer = doc.createElement('div');
  layer.className = styles.layer ?? '';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < PIECES; i++) {
    const piece = doc.createElement('span');
    piece.className = styles.piece ?? '';
    piece.style.setProperty('--x', `${(random() * 100).toFixed(1)}vw`);
    piece.style.setProperty('--drift', `${((random() - 0.5) * 30).toFixed(1)}vw`);
    piece.style.setProperty('--spin', `${Math.round(random() * 720 - 360)}deg`);
    piece.style.setProperty('--delay', `${Math.round(random() * 250)}ms`);
    piece.style.background = COLORS[i % COLORS.length] ?? '';
    layer.append(piece);
  }
  doc.body.append(layer);
  win.setTimeout(() => layer.remove(), LIFETIME_MS);
  return true;
}

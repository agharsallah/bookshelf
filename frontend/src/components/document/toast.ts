/**
 * Toasts: short confirmations after an action ("Queued: summarize chapter 3").
 * A plain DOM utility rather than shared React state (D10): any island calls
 * `toast()`, which writes into one polite live region created on first use.
 */
import styles from './toast.module.css';

export type ToastTone = 'info' | 'good' | 'bad';

const REGION_ID = 'bookshelf-toasts';
const LIFETIME_MS = 5000;

function region(doc: Document): HTMLElement {
  const existing = doc.getElementById(REGION_ID);
  if (existing) return existing;
  const el = doc.createElement('div');
  el.id = REGION_ID;
  el.className = styles.region ?? '';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  doc.body.append(el);
  return el;
}

/** Show a message for a few seconds; returns a function that dismisses it early. */
export function toast(message: string, tone: ToastTone = 'info', doc: Document = document): () => void {
  const item = doc.createElement('p');
  item.className = styles.toast ?? '';
  item.dataset.tone = tone;
  item.textContent = message;
  region(doc).append(item);
  const remove = () => item.remove();
  const timer = setTimeout(remove, LIFETIME_MS);
  return () => {
    clearTimeout(timer);
    remove();
  };
}

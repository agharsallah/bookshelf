/**
 * Toasts: short confirmations after an action ("Queued: summarize chapter 3").
 * A plain DOM utility rather than shared React state (D10): any island calls
 * `toast()`, which writes into one polite live region created on first use.
 */
import styles from './toast.module.css';

export type ToastTone = 'info' | 'good' | 'bad';

const REGION_ID = 'bookshelf-toasts';
const LIFETIME_MS = 5000;

/**
 * A region created now cannot announce what is put in it in the same moment: screen
 * readers only report changes to a live region they already know about.
 */
const FIRST_MESSAGE_DELAY_MS = 100;

function region(doc: Document): { el: HTMLElement; fresh: boolean } {
  const existing = doc.getElementById(REGION_ID);
  if (existing) return { el: existing, fresh: false };
  const el = doc.createElement('div');
  el.id = REGION_ID;
  el.className = styles.region ?? '';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  doc.body.append(el);
  return { el, fresh: true };
}

/** Show a message for a few seconds; returns a function that dismisses it early. */
export function toast(message: string, tone: ToastTone = 'info', doc: Document = document): () => void {
  const item = doc.createElement('p');
  item.className = styles.toast ?? '';
  item.dataset.tone = tone;
  item.textContent = message;
  const { el, fresh } = region(doc);
  let timer: ReturnType<typeof setTimeout>;
  const show = () => {
    el.append(item);
    timer = setTimeout(() => item.remove(), LIFETIME_MS);
  };
  if (fresh) timer = setTimeout(show, FIRST_MESSAGE_DELAY_MS);
  else show();
  return () => {
    clearTimeout(timer);
    item.remove();
  };
}

/**
 * How the app cheers you on: the tone (quiet words in the app's own voice, or playful ones
 * with emoji, levels and a burst of colour on a big win) and an optional daily reading goal
 * in minutes. Both are kept in this browser.
 *
 * The tone is written to `<html data-cheer>` before first paint by `bootstrapCheer`
 * (serialized inline like the theme and workshop bootstraps), so server-rendered copy can
 * carry both voices and let CSS show one (`data-cheer-only`, base.css; see `Cheer.tsx`).
 */

export const CHEER_TONES = ['quiet', 'playful'] as const;
export type CheerTone = (typeof CHEER_TONES)[number];

/** Minutes a day; 0 is no goal. */
export const GOAL_CHOICES = [0, 10, 20, 30, 60] as const;
export type DailyGoal = (typeof GOAL_CHOICES)[number];

export const CHEER_STORAGE_KEY = 'bookshelf:cheer';
export const GOAL_STORAGE_KEY = 'bookshelf:goal';
export const CHEER_CHANGE_EVENT = 'bookshelf:cheerchange';

export interface CheerHost {
  localStorage: Pick<Storage, 'getItem'>;
  document: { documentElement: { dataset: DOMStringMap } };
}

/**
 * Runs inline in <head>. Self-contained on purpose: it is stringified with
 * `Function#toString`, so it may not read module constants.
 */
export function bootstrapCheer(host: CheerHost): void {
  let stored: string | null = null;
  try {
    stored = host.localStorage.getItem('bookshelf:cheer');
  } catch {
    // Blocked storage means the default: quiet.
  }
  host.document.documentElement.dataset.cheer = stored === 'playful' ? 'playful' : 'quiet';
}

export const cheerBootstrapScript = `(${bootstrapCheer.toString()})(window);`;

export function cheerTone(doc: Document = document): CheerTone {
  return doc.documentElement.dataset.cheer === 'playful' ? 'playful' : 'quiet';
}

function store(win: Window, key: string, value: string): void {
  try {
    win.localStorage.setItem(key, value);
  } catch {
    // Persisting is best-effort; the choice still applies to this page.
  }
}

/** Switch tone, persist it and announce it, as the workshop switch does. */
export function setCheerTone(tone: CheerTone, win: Window = window): void {
  win.document.documentElement.dataset.cheer = tone;
  store(win, CHEER_STORAGE_KEY, tone);
  win.dispatchEvent(new CustomEvent<CheerTone>(CHEER_CHANGE_EVENT, { detail: tone }));
}

export function readGoal(storage: Pick<Storage, 'getItem'> = window.localStorage): DailyGoal {
  let minutes: number;
  try {
    minutes = Number(storage.getItem(GOAL_STORAGE_KEY));
  } catch {
    return 0;
  }
  return GOAL_CHOICES.find((g) => g === minutes) ?? 0;
}

export function saveGoal(goal: DailyGoal, win: Window = window): void {
  store(win, GOAL_STORAGE_KEY, String(goal));
}

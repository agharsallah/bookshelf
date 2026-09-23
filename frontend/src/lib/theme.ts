/**
 * Theme preference: `light` | `dark`, stored in localStorage; absent means "follow
 * the OS". The resolved theme is written to `<html data-theme>` before first paint
 * by `bootstrapTheme`, which is serialized into an inline <script> in the layout,
 * so it must stay self-contained (no references to module scope).
 */

export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'bookshelf:theme';
export const THEME_CHANGE_EVENT = 'bookshelf:themechange';

/** Stored preference wins; otherwise the OS preference. */
export function resolveTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersDark ? 'dark' : 'light';
}

/** Minimal slice of `window` the bootstrap needs, so tests can pass a fake. */
export interface ThemeHost {
  localStorage: Pick<Storage, 'getItem'>;
  matchMedia: (query: string) => { matches: boolean };
  document: { documentElement: { dataset: DOMStringMap } };
}

/**
 * Runs inline in <head>. Self-contained on purpose: it is stringified with
 * `Function#toString`, so it may not call `resolveTheme` or read module constants.
 */
export function bootstrapTheme(host: ThemeHost): void {
  let stored: string | null = null;
  try {
    stored = host.localStorage.getItem('bookshelf:theme');
  } catch {
    // Storage can be blocked (private mode, sandboxed frames): fall back to the OS.
  }
  const theme =
    stored === 'light' || stored === 'dark'
      ? stored
      : host.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
  host.document.documentElement.dataset.theme = theme;
}

/** The inline script body for the layout head. */
export const themeBootstrapScript = `(${bootstrapTheme.toString()})(window);`;

/** Current theme as applied to the document. */
export function currentTheme(doc: Document = document): Theme {
  return doc.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** Apply and persist a theme, then announce it (Mermaid re-renders on this). */
export function setTheme(theme: Theme, win: Window = window): void {
  win.document.documentElement.dataset.theme = theme;
  try {
    win.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Persisting is best-effort; the choice still applies to this page.
  }
  win.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
}

/**
 * Keep following the OS while the reader hasn't chosen a theme: the bootstrap only
 * runs once, so live OS switches (sunset, a manual toggle) are applied here.
 */
export function followSystemTheme(win: Window = window): void {
  const query = win.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', (event) => {
    let stored: string | null = null;
    try {
      stored = win.localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Treat unreadable storage as "no preference".
    }
    if (stored === 'light' || stored === 'dark') return;
    const theme = resolveTheme(null, event.matches);
    win.document.documentElement.dataset.theme = theme;
    win.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
  });
}

/**
 * Shelf or list: how the library is shown. The choice is the reader's own, kept in
 * localStorage (never in the URL, so shared links open in the viewer's own view).
 * The server renders the shelf; an inline script swaps one class before first paint
 * when the reader chose the list. Blocked storage simply means the default.
 */

export const VIEWS = ['shelf', 'list'] as const;
export type LibraryView = (typeof VIEWS)[number];

export const DEFAULT_VIEW: LibraryView = 'shelf';
export const VIEW_STORAGE_KEY = 'bookshelf:library-view';

export function parseView(value: string | null | undefined): LibraryView {
  return (VIEWS as readonly string[]).includes(value ?? '') ? (value as LibraryView) : DEFAULT_VIEW;
}

export function readView(storage: Pick<Storage, 'getItem'> | undefined): LibraryView {
  try {
    return parseView(storage?.getItem(VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_VIEW;
  }
}

/** Remember the view; false when storage refused it (the choice still applies now). */
export function saveView(storage: Pick<Storage, 'setItem'> | undefined, view: LibraryView): boolean {
  try {
    if (!storage) return false;
    storage.setItem(VIEW_STORAGE_KEY, view);
    return true;
  } catch {
    return false;
  }
}

/** The class on the library that picks the view (`view-shelf` / `view-list`). */
export const viewClass = (view: LibraryView): string => `view-${view}`;

/**
 * Runs inline right after the library's opening tag, before first paint. Self-contained
 * on purpose (stringified with `Function#toString`), like the theme bootstrap.
 */
export function bootstrapView(root: Element | null, host: { localStorage: Pick<Storage, 'getItem'> }): void {
  let stored: string | null = null;
  try {
    stored = host.localStorage.getItem('bookshelf:library-view');
  } catch {
    // Blocked storage: keep the server's shelf.
  }
  if (root && stored === 'list') {
    root.classList.remove('view-shelf');
    root.classList.add('view-list');
  }
}

/** The inline bootstrap, run as the library's first child. */
export const viewBootstrapScript = `(${bootstrapView.toString()})(document.currentScript.parentElement, window);`;

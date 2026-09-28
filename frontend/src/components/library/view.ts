/**
 * How the library is shown, the reader's own choice kept in localStorage (never in the
 * URL, so shared links open in the viewer's own display): shelf or list (`view`), the
 * dimension the spines are dyed by (`by`, `facets.ts`), and whether the books stand in
 * groups of that dimension (`group`). Each is a class on the library (`view-list`,
 * `by-reading`, `group-on`); the server renders the defaults and an inline script swaps
 * the stored ones in before first paint. Blocked storage simply means the defaults.
 */
import { DEFAULT_DIMENSION, DIMENSIONS } from './facets';

export const VIEWS = ['shelf', 'list'] as const;
export type LibraryView = (typeof VIEWS)[number];
export const DEFAULT_VIEW: LibraryView = 'shelf';

export const GROUPINGS = ['off', 'on'] as const;

export const PREFS = {
  view: { key: 'bookshelf:library-view', values: VIEWS, fallback: DEFAULT_VIEW },
  by: { key: 'bookshelf:library-colour', values: DIMENSIONS, fallback: DEFAULT_DIMENSION },
  group: { key: 'bookshelf:library-group', values: GROUPINGS, fallback: 'off' },
} as const;
export type PrefName = keyof typeof PREFS;
export type PrefValue<N extends PrefName> = (typeof PREFS)[N]['values'][number];

export const VIEW_STORAGE_KEY = PREFS.view.key;

export function parsePref<N extends PrefName>(name: N, value: string | null | undefined): PrefValue<N> {
  const pref = PREFS[name];
  return ((pref.values as readonly string[]).includes(value ?? '') ? value : pref.fallback) as PrefValue<N>;
}

export function readPref<N extends PrefName>(storage: Pick<Storage, 'getItem'> | undefined, name: N): PrefValue<N> {
  try {
    return parsePref(name, storage?.getItem(PREFS[name].key));
  } catch {
    return PREFS[name].fallback as PrefValue<N>;
  }
}

/** Remember a choice; false when storage refused it (the choice still applies now). */
export function savePref<N extends PrefName>(storage: Pick<Storage, 'setItem'> | undefined, name: N, value: PrefValue<N>): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PREFS[name].key, value);
    return true;
  } catch {
    return false;
  }
}

/** The class on the library for a choice (`view-shelf`, `by-kind`, `group-off`). */
export const prefClass = <N extends PrefName>(name: N, value: PrefValue<N>): string => `${name}-${value}`;

/** The classes the server renders: every default. */
export const defaultClasses = (): string[] =>
  (Object.keys(PREFS) as PrefName[]).map((name) => prefClass(name, PREFS[name].fallback));

/** `[storage key, class prefix, allowed values]` for each choice, handed to the bootstrap. */
type PrefTable = readonly (readonly [string, string, readonly string[]])[];
const TABLE: PrefTable = (Object.keys(PREFS) as PrefName[]).map((name) => [PREFS[name].key, name, PREFS[name].values]);

/**
 * Runs inline right after the library's opening tag, before first paint. Self-contained
 * on purpose (stringified with `Function#toString`, the table passed in), like the theme
 * bootstrap.
 */
export function bootstrapView(root: Element | null, host: { localStorage: Pick<Storage, 'getItem'> }, table: PrefTable): void {
  if (!root) return;
  for (const [key, prefix, values] of table) {
    let stored: string | null = null;
    try {
      stored = host.localStorage.getItem(key);
    } catch {
      // Blocked storage: keep the server's default.
    }
    if (stored === null || !values.includes(stored)) continue;
    for (const value of values) root.classList.remove(`${prefix}-${value}`);
    root.classList.add(`${prefix}-${stored}`);
  }
}

/** The inline bootstrap, run as the library's first child. */
export const viewBootstrapScript = `(${bootstrapView.toString()})(document.currentScript.parentElement, window, ${JSON.stringify(TABLE)});`;

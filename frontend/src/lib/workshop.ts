/**
 * Reading or workshop mode. Reading (the default) keeps to what a reader needs: the
 * books, their study material, search and concepts. Workshop shows the machinery too:
 * the review queue and pipeline in the navigation, re-runs, job histories, skill
 * versions and gate scores. Anything marked `workshop-only` (a global class) is hidden
 * outside workshop mode, so server-rendered pages and islands follow one switch.
 *
 * The choice is stored in localStorage and written to `<html data-workshop>` before
 * first paint by `bootstrapWorkshop`, serialized inline like the theme bootstrap.
 */

export const WORKSHOP_STORAGE_KEY = 'bookshelf:workshop';
export const WORKSHOP_CHANGE_EVENT = 'bookshelf:workshopchange';
/** The global class that hides an element outside workshop mode (base.css). */
export const WORKSHOP_ONLY = 'workshop-only';

export interface WorkshopHost {
  localStorage: Pick<Storage, 'getItem'>;
  document: { documentElement: { dataset: DOMStringMap } };
}

/**
 * Runs inline in <head>. Self-contained on purpose: it is stringified with
 * `Function#toString`, so it may not read module constants.
 */
export function bootstrapWorkshop(host: WorkshopHost): void {
  let stored: string | null = null;
  try {
    stored = host.localStorage.getItem('bookshelf:workshop');
  } catch {
    // Blocked storage means the default: reading mode.
  }
  if (stored === 'on') host.document.documentElement.dataset.workshop = '';
  else delete host.document.documentElement.dataset.workshop;
}

export const workshopBootstrapScript = `(${bootstrapWorkshop.toString()})(window);`;

export function isWorkshop(doc: Document = document): boolean {
  return doc.documentElement.dataset.workshop !== undefined;
}

/** Switch mode, persist it and announce it (islands that render differently listen). */
export function setWorkshop(on: boolean, win: Window = window): void {
  if (on) win.document.documentElement.dataset.workshop = '';
  else delete win.document.documentElement.dataset.workshop;
  try {
    win.localStorage.setItem(WORKSHOP_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // Persisting is best-effort; the choice still applies to this page.
  }
  win.dispatchEvent(new CustomEvent<boolean>(WORKSHOP_CHANGE_EVENT, { detail: on }));
}

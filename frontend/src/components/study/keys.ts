/**
 * Page-wide study shortcuts, and when to leave a key alone: while you type in a field,
 * with a modifier held (browser and system shortcuts), or Space/Enter on a focused
 * control, which already presses it.
 */

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);
const CONTROLS = new Set(['BUTTON', 'A', 'SUMMARY']);

interface KeyLike {
  key: string;
  target: EventTarget | null;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

function tagOf(target: EventTarget | null): string {
  return target && 'tagName' in target ? String((target as Element).tagName) : '';
}

function isEditable(target: EventTarget | null): boolean {
  return Boolean(target && 'isContentEditable' in target && (target as HTMLElement).isContentEditable);
}

/** Whether a study shortcut may take this key press. */
export function shortcutApplies(event: KeyLike): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  const tag = tagOf(event.target);
  if (FIELDS.has(tag) || isEditable(event.target)) return false;
  if ((event.key === ' ' || event.key === 'Enter') && CONTROLS.has(tag)) return false;
  return true;
}

/**
 * The reader's single-key shortcuts. Movement and notes (j/k, [/], n, Esc) are
 * handled by `useReaderEvents` directly; the layout and reading-aid toggles map
 * to actions here, and the `?` sheet lists them all.
 */
import type { Shortcut } from '../common/ShortcutHelp';

export type ReaderAction = 'focus' | 'fullscreen' | 'contents' | 'pane' | 'semantic' | 'spotlight' | 'bigger' | 'smaller' | 'help';

const ACTION_KEYS: Readonly<Record<string, ReaderAction>> = {
  f: 'focus',
  F: 'fullscreen',
  t: 'contents',
  d: 'pane',
  c: 'semantic',
  s: 'spotlight',
  '+': 'bigger',
  '=': 'bigger',
  '-': 'smaller',
  '?': 'help',
};

/** The action a key press asks for, if any. Modified presses (⌘, Ctrl, Alt) never map. */
export function actionFor(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>): ReaderAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return Object.hasOwn(ACTION_KEYS, event.key) ? (ACTION_KEYS[event.key] ?? null) : null;
}

export const READER_SHORTCUTS: readonly Shortcut[] = [
  { keys: ['j', 'k'], label: 'Next / previous block' },
  { keys: ['[', ']'], label: 'Previous / next chapter' },
  { keys: ['n'], label: 'Note on the selection or block' },
  { keys: ['f'], label: 'Focus mode' },
  { keys: ['⇧F'], label: 'Full screen' },
  { keys: ['t'], label: 'Show or hide the contents' },
  { keys: ['d'], label: 'Show or hide the distillation' },
  { keys: ['c'], label: 'Colour-code quotes, examples, asides' },
  { keys: ['s'], label: 'Spotlight the block being read' },
  { keys: ['+', '−'], label: 'Larger / smaller text' },
  { keys: ['?'], label: 'Show these shortcuts' },
  { keys: ['Esc'], label: 'Close, or leave focus mode' },
];

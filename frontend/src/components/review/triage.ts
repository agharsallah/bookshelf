/**
 * Keyboard-first triage: the key map and the cursor/selection reducer.
 *
 * The queue is a list of ids in walk order. Approving or rejecting removes an item
 * optimistically; the cursor keeps its index, so it lands on the next item. Undo
 * reopens the artifact, which brings it back through `sync`; `focus` then lands on it.
 */

export type TriageCommand =
  | 'next'
  | 'prev'
  | 'approve'
  | 'reject'
  | 'edit'
  | 'open'
  | 'select'
  | 'undo'
  | 'help'
  | 'escape';

export interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** Tag name of the event target; typing in a field never triggers a shortcut. */
  targetTag?: string;
  targetEditable?: boolean;
}

const KEYMAP: Readonly<Record<string, TriageCommand>> = {
  j: 'next',
  ArrowDown: 'next',
  k: 'prev',
  ArrowUp: 'prev',
  a: 'approve',
  r: 'reject',
  e: 'edit',
  Enter: 'open',
  x: 'select',
  u: 'undo',
  '?': 'help',
  Escape: 'escape',
};

/** The shortcut sheet, in the order the help dialog lists it. */
export const SHORTCUTS: readonly { keys: string[]; label: string }[] = [
  { keys: ['j', '↓'], label: 'Next item' },
  { keys: ['k', '↑'], label: 'Previous item' },
  { keys: ['a'], label: 'Approve' },
  { keys: ['r'], label: 'Reject' },
  { keys: ['e'], label: 'Edit' },
  { keys: ['Enter'], label: 'Open full review' },
  { keys: ['x'], label: 'Select for bulk approval' },
  { keys: ['u'], label: 'Undo the last action' },
  { keys: ['?'], label: 'Show or hide shortcuts' },
  { keys: ['Esc'], label: 'Close help, clear selection' },
];

const FIELDS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function keyToCommand(input: KeyInput): TriageCommand | null {
  if (input.metaKey || input.ctrlKey || input.altKey) return null;
  const inField = input.targetEditable === true || FIELDS.has((input.targetTag ?? '').toUpperCase());
  if (inField && input.key !== 'Escape') return null;
  return KEYMAP[input.key] ?? null;
}

export interface TriageState {
  order: string[];
  cursor: number;
  selected: string[];
  help: boolean;
}

export type TriageAction =
  | { type: 'sync'; order: string[] }
  | { type: 'move'; by: 1 | -1 }
  | { type: 'focus'; id: string }
  | { type: 'toggleSelect'; id: string }
  | { type: 'selectOnly'; ids: string[] }
  | { type: 'clearSelection' }
  | { type: 'help'; open?: boolean }
  | { type: 'remove'; ids: string[] };

export function initialTriage(order: string[]): TriageState {
  return { order, cursor: 0, selected: [], help: false };
}

const clamp = (index: number, length: number) => Math.max(0, Math.min(index, Math.max(length - 1, 0)));

/** The focused id, or null for an empty queue. */
export function currentId(state: TriageState): string | null {
  return state.order[state.cursor] ?? null;
}

export function triageReducer(state: TriageState, action: TriageAction): TriageState {
  switch (action.type) {
    case 'sync': {
      const focused = currentId(state);
      const keep = focused ? action.order.indexOf(focused) : -1;
      const selected = state.selected.filter((id) => action.order.includes(id));
      return { ...state, order: action.order, selected, cursor: keep >= 0 ? keep : clamp(state.cursor, action.order.length) };
    }
    case 'move':
      return { ...state, cursor: clamp(state.cursor + action.by, state.order.length) };
    case 'focus': {
      const index = state.order.indexOf(action.id);
      return index < 0 ? state : { ...state, cursor: index };
    }
    case 'toggleSelect': {
      const selected = state.selected.includes(action.id)
        ? state.selected.filter((id) => id !== action.id)
        : [...state.selected, action.id];
      return { ...state, selected };
    }
    case 'selectOnly':
      return { ...state, selected: action.ids.filter((id) => state.order.includes(id)) };
    case 'clearSelection':
      return { ...state, selected: [] };
    case 'help':
      return { ...state, help: action.open ?? !state.help };
    case 'remove': {
      const gone = new Set(action.ids.filter((id) => state.order.includes(id)));
      if (gone.size === 0) return state;
      const order = state.order.filter((id) => !gone.has(id));
      const before = state.order.slice(0, state.cursor).filter((id) => gone.has(id)).length;
      return {
        ...state,
        order,
        cursor: clamp(state.cursor - before, order.length),
        selected: state.selected.filter((id) => !gone.has(id)),
      };
    }
  }
}

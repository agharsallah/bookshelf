/**
 * The command palette (⌘K / Ctrl-K, or the masthead button): jump to a book, a chapter
 * or a concept as you type, or hand the words to Search or Ask. A combobox over a
 * listbox: ↑/↓ move, Enter opens, Esc closes and returns focus where it was. The dialog
 * is portalled to <body> so it covers the page, not just the masthead it is mounted in.
 */
import { useCallback, useEffect, useReducer, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { SuggestResponse } from '../../lib/api/types/search';
import { activeItem, buildItems, closedPalette, isPaletteShortcut, paletteReducer, recentItems, type PaletteItem, type PaletteKind } from './palette';
import { loadRecent, RECENT_SEARCHES_KEY } from './recent';
import styles from './Palette.module.css';

const KIND_LABELS: Record<PaletteKind, string> = {
  document: 'Book',
  chapter: 'Chapter',
  concept: 'Concept',
  search: 'Search',
  ask: 'Ask',
  recent: 'Recent',
};

export interface CommandPaletteProps {
  api?: ApiClient;
  navigate?: (href: string) => void;
  debounceMs?: number;
}

function go(href: string) {
  window.location.assign(href);
}

export function CommandPalette({ api = browserApi, navigate = go, debounceMs = 120 }: CommandPaletteProps) {
  const [state, dispatch] = useReducer(paletteReducer, closedPalette);
  const input = useRef<HTMLInputElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const recent = useCallback(() => recentItems(loadRecent(RECENT_SEARCHES_KEY)), []);

  const open = useCallback(() => {
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dispatch({ type: 'open', recent: recent() });
  }, [recent]);

  const close = useCallback(() => {
    dispatch({ type: 'close' });
    returnTo.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (state.open) close();
      else open();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.open, open, close]);

  useEffect(() => {
    if (state.open) input.current?.focus();
  }, [state.open]);

  const { query } = state;
  useEffect(() => {
    const q = query.trim();
    if (!state.open || !q) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const suggest = await api
        .get<SuggestResponse>('search/suggest', { query: { q: q.slice(0, 100), limit: 10 }, signal: controller.signal })
        .then((response) => response.items)
        .catch(() => []);
      if (controller.signal.aborted) return;
      dispatch({ type: 'results', query, items: buildItems(q, suggest) });
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, query, state.open, debounceMs]);

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    dispatch({ type: 'close' });
    navigate(item.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      dispatch({ type: 'move', delta: event.key === 'ArrowDown' ? 1 : -1 });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeItem(state));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  };

  const active = activeItem(state);
  return (
    <>
      <button type="button" className={styles.trigger} onClick={open} aria-haspopup="dialog" aria-keyshortcuts="Meta+K Control+K">
        <span>Jump to…</span>
        <kbd className={styles.kbd}>⌘K</kbd>
      </button>
      {state.open
        ? createPortal(
        <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className={styles.dialog} role="dialog" aria-modal="true" aria-label="Jump to">
            <input
              ref={input}
              className={styles.input}
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-activedescendant={active ? `palette-${active.id}` : undefined}
              aria-autocomplete="list"
              placeholder="A book, a chapter, a concept, or a question"
              value={state.query}
              onChange={(e) => dispatch({ type: 'query', query: e.target.value, recent: recent() })}
              onKeyDown={onKeyDown}
              autoComplete="off"
              spellCheck={false}
            />
            <ul id="palette-list" className={styles.list} role="listbox" aria-label="Destinations" aria-busy={state.loading}>
              {state.items.map((item, i) => (
                <li
                  key={item.id}
                  id={`palette-${item.id}`}
                  role="option"
                  aria-selected={i === state.active}
                  className={styles.option}
                  data-kind={item.kind}
                  onMouseMove={() => i !== state.active && dispatch({ type: 'point', index: i })}
                  onClick={() => choose(item)}
                >
                  <span className={styles.kind}>{KIND_LABELS[item.kind]}</span>
                  <span className={styles.label}>{item.label}</span>
                  {item.detail ? <span className={styles.detail}>{item.detail}</span> : null}
                </li>
              ))}
            </ul>
            {state.items.length === 0 ? (
              <p className={styles.hint}>{state.query.trim() ? 'Looking…' : 'Type to find a book, a chapter or a concept.'}</p>
            ) : null}
            <p className={styles.keys} aria-hidden="true">
              ↑↓ to move, Enter to open, Esc to close
            </p>
          </div>
        </div>,
            // The masthead's backdrop-filter would trap a fixed overlay inside it.
            document.body,
          )
        : null}
    </>
  );
}

export default CommandPalette;

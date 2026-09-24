/**
 * Toasts: short confirmations in a polite live region, with an optional Undo. Each
 * dismisses itself after `ttl`; the undo window and the toast share that clock. A toast
 * with an Undo lives at least `UNDO_MIN_MS`, and no toast leaves while it is hovered or
 * has focus: its clock restarts when the pointer and focus leave (WCAG 2.2.1).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Toasts.module.css';

export interface Toast {
  id: string;
  message: string;
  tone?: 'ok' | 'info' | 'error';
  /** Shown as a button; the toast closes when it is used. */
  undo?: () => void;
  ttl?: number;
}

export const UNDO_MIN_MS = 10_000;

export function useToasts(defaultTtl = 6000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lifetimes = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    lifetimes.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const arm = useCallback(
    (id: string) => {
      clearTimeout(timers.current.get(id));
      const ms = lifetimes.current.get(id);
      if (ms !== undefined) timers.current.set(id, setTimeout(() => dismiss(id), ms));
    },
    [dismiss],
  );

  const push = useCallback(
    (toast: Toast) => {
      setToasts((all) => [...all.filter((t) => t.id !== toast.id), toast].slice(-4));
      lifetimes.current.set(toast.id, Math.max(toast.ttl ?? defaultTtl, toast.undo ? UNDO_MIN_MS : 0));
      arm(toast.id);
    },
    [defaultTtl, arm],
  );

  /** Stop a toast's clock (it is hovered or focused). */
  const hold = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  /** Remove the Undo button from a toast whose action can no longer be taken back. */
  const settle = useCallback((id: string) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, undo: undefined } : t)));
  }, []);

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach(clearTimeout);
  }, []);

  return { toasts, push, dismiss, settle, hold, release: arm };
}

export interface ToasterProps {
  toasts: readonly Toast[];
  onDismiss: (id: string) => void;
  /** Pause a toast's clock while it is hovered or focused (`useToasts().hold`). */
  onHold?: (id: string) => void;
  /** Restart it once pointer and focus have left (`useToasts().release`). */
  onRelease?: (id: string) => void;
}

function hovered(el: Element): boolean {
  try {
    return el.matches(':hover');
  } catch {
    return false;
  }
}

export function Toaster({ toasts, onDismiss, onHold, onRelease }: ToasterProps) {
  return (
    <div className={styles.region} role="status" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={styles.toast}
          data-tone={toast.tone ?? 'ok'}
          onMouseEnter={() => onHold?.(toast.id)}
          onMouseLeave={(e) => !e.currentTarget.contains(document.activeElement) && onRelease?.(toast.id)}
          onFocus={() => onHold?.(toast.id)}
          onBlur={(e) => {
            const next = e.relatedTarget instanceof Node ? e.relatedTarget : null;
            if (!e.currentTarget.contains(next) && !hovered(e.currentTarget)) onRelease?.(toast.id);
          }}
        >
          <p className={styles.message}>{toast.message}</p>
          {toast.undo ? (
            <button
              type="button"
              className={styles.undo}
              onClick={() => {
                toast.undo?.();
                onDismiss(toast.id);
              }}
            >
              Undo
            </button>
          ) : null}
          <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

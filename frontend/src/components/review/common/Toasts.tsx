/**
 * Toasts: short confirmations in a polite live region, with an optional Undo. Each
 * dismisses itself after `ttl`; the undo window and the toast share that clock.
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

export function useToasts(defaultTtl = 6000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Toast) => {
      setToasts((all) => [...all.filter((t) => t.id !== toast.id), toast].slice(-4));
      clearTimeout(timers.current.get(toast.id));
      timers.current.set(toast.id, setTimeout(() => dismiss(toast.id), toast.ttl ?? defaultTtl));
    },
    [defaultTtl, dismiss],
  );

  /** Remove the Undo button from a toast whose action can no longer be taken back. */
  const settle = useCallback((id: string) => {
    setToasts((all) => all.map((t) => (t.id === id ? { ...t, undo: undefined } : t)));
  }, []);

  useEffect(() => {
    const live = timers.current;
    return () => live.forEach(clearTimeout);
  }, []);

  return { toasts, push, dismiss, settle };
}

export function Toaster({ toasts, onDismiss }: { toasts: readonly Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div className={styles.region} role="status" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => (
        <div key={toast.id} className={styles.toast} data-tone={toast.tone ?? 'ok'}>
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

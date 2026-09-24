/** The `?` sheet: a list of keyboard shortcuts, in a modal dialog that returns focus on close. */
import { useEffect, useRef } from 'react';
import styles from './ShortcutHelp.module.css';

export interface Shortcut {
  keys: readonly string[];
  label: string;
}

export interface ShortcutHelpProps {
  open: boolean;
  shortcuts: readonly Shortcut[];
  onClose: () => void;
}

export function ShortcutHelp({ open, shortcuts, onClose }: ShortcutHelpProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
  }, [open]);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="shortcuts-title" onClose={onClose} onCancel={onClose}>
      <h2 id="shortcuts-title" className={styles.title}>
        Keyboard shortcuts
      </h2>
      <dl className={styles.list}>
        {shortcuts.map((s) => (
          <div key={s.label} className={styles.item}>
            <dt>
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{s.label}</dd>
          </div>
        ))}
      </dl>
      <form method="dialog">
        <button type="submit" className={styles.close} onClick={onClose}>
          Close
        </button>
      </form>
    </dialog>
  );
}

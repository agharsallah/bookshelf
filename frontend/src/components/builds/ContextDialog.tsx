/**
 * The rendered context in a modal dialog (the `RemoveDialog` pattern: a native `<dialog>`,
 * so focus stays inside and Escape closes it). It loads when it opens, never before.
 */
import { useEffect, useId, useRef, useState } from 'react';
import type { BuildContextView } from '../../lib/api/types/builds';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import styles from './Viewer.module.css';
import { ContextViewer } from './ContextViewer';

export interface ContextDialogProps {
  open: boolean;
  onClose: () => void;
  load: () => Promise<BuildContextView>;
  extraCommands?: readonly string[];
}

export function ContextDialog({ open, onClose, load, extraCommands }: ContextDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [view, setView] = useState<BuildContextView | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  // The loader as of opening: the form's options right then, not as they change behind it.
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal?.();
    if (!open && el.open) el.close?.();
    if (!open) return;
    let live = true;
    setView(null);
    setProblem(null);
    loader.current().then(
      (v) => live && setView(v),
      (error: unknown) => live && setProblem(problemOf(error)),
    );
    return () => {
      live = false;
    };
  }, [open]);

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`${id}-title`} onClose={onClose} onCancel={onClose}>
      <div className={styles.dialogHead}>
        <h2 id={`${id}-title`} className={styles.dialogTitle}>
          What the agent will read
        </h2>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Close
        </button>
      </div>
      {open ? (
        problem ? (
          <Problem inline title="The preview could not be rendered." problem={problem} />
        ) : view ? (
          <ContextViewer view={view} extraCommands={extraCommands} />
        ) : (
          <p className={styles.loading} role="status">
            Rendering the files…
          </p>
        )
      ) : null}
    </dialog>
  );
}

/** A button that asks once more before acting: the first press arms it, the second acts. */
import { useState } from 'react';
import fields from './Fields.module.css';

export interface ConfirmButtonProps {
  label: string;
  /** The question shown once armed: "Stop the build now?". */
  question: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
}

export function ConfirmButton({ label, question, confirmLabel, busy = false, onConfirm }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button type="button" className="btn" disabled={busy} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className={fields.actions} role="group" aria-label={question}>
      <span className={fields.hint}>{question}</span>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-quiet" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  );
}

/** A command to paste into Claude Code, with a Copy button (and the text selectable anyway). */
import { useState } from 'react';
import styles from './Review.module.css';

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <p className={styles.command}>
      <code>{command}</code>
      <button type="button" className="btn" onClick={() => void copy()}>
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="visually-hidden" aria-live="polite">
        {copied === true ? 'Copied to the clipboard' : copied === false ? 'Could not copy; select the text instead' : ''}
      </span>
    </p>
  );
}

export default CopyCommand;

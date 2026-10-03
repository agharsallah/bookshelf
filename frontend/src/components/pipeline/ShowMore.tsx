/**
 * Long lists, a page at a time: the first `step` items, then "Show N more" and "Show all".
 * The page grows; it never resets under the reader while the list updates live.
 */
import { useState } from 'react';
import styles from './Pipeline.module.css';

export function useShowMore(step: number) {
  const [limit, setLimit] = useState(step);
  return { limit, more: () => setLimit((l) => l + step), all: () => setLimit(Number.POSITIVE_INFINITY) };
}

export interface ShowMoreProps {
  shown: number;
  total: number;
  step: number;
  noun: string;
  onMore: () => void;
  onAll: () => void;
}

export function ShowMore({ shown, total, step, noun, onMore, onAll }: ShowMoreProps) {
  if (shown >= total) return null;
  const next = Math.min(step, total - shown);
  return (
    <p className={styles.showMore}>
      <span className={styles.muted}>
        Showing {shown} of {total} {noun}.
      </span>
      <button type="button" className="btn" onClick={onMore}>
        Show {next} more
      </button>
      {total - shown > step ? (
        <button type="button" className="btn btn-quiet" onClick={onAll}>
          Show all {total}
        </button>
      ) : null}
    </p>
  );
}

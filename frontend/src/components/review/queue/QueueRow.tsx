/**
 * One item in the queue: what it is (tool voice), the chapter it covers (the book's
 * words), its status, who wrote it, and its gate marks.
 */
import { forwardRef } from 'react';
import { anchorLabel } from '../../../lib/anchors';
import type { ArtifactListItem } from '../../../lib/api/types/artifacts';
import type { SkillGates } from '../../../lib/api/types/skills';
import { GateBadges } from '../GateBadges';
import { authorship, relativeTime, REVIEW_LABELS, TYPE_LABELS } from '../labels';
import styles from './Queue.module.css';

export interface QueueRowProps {
  item: ArtifactListItem;
  heading: string | undefined;
  focused: boolean;
  selected: boolean;
  thresholds: SkillGates | null | undefined;
  onFocus: (id: string) => void;
  /** Click or tap: focus it (wide) or open it (narrow, no preview pane). */
  onActivate: (id: string) => void;
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
}

export const QueueRow = forwardRef<HTMLButtonElement, QueueRowProps>(function QueueRow(
  { item, heading, focused, selected, thresholds, onFocus, onActivate, onOpen, onToggle },
  ref,
) {
  const label = `${TYPE_LABELS[item.type]}${item.anchor ? ` ${anchorLabel(item.anchor)}` : ''}`;
  return (
    <li className={styles.row} data-review={item.review} data-focused={focused || undefined} data-selected={selected || undefined}>
      <input
        type="checkbox"
        className={styles.check}
        checked={selected}
        aria-label={`Select ${label} for bulk approval`}
        tabIndex={-1}
        onChange={() => onToggle(item.id)}
      />
      <button
        ref={ref}
        type="button"
        className={styles.rowMain}
        tabIndex={focused ? 0 : -1}
        aria-current={focused || undefined}
        onClick={() => onActivate(item.id)}
        onDoubleClick={() => onOpen(item.id)}
        onFocus={() => onFocus(item.id)}
      >
        <span className={styles.rowTitle}>
          <span className={styles.rowType}>{TYPE_LABELS[item.type]}</span>
          {item.anchor ? (
            <span className={styles.rowAnchor} title={item.anchor}>
              {anchorLabel(item.anchor)}
            </span>
          ) : null}
          {heading ? <span className={styles.rowHeading}>{heading}</span> : null}
        </span>
        <span className={styles.rowMeta}>
          <span className={styles.status} data-review={item.review}>
            {REVIEW_LABELS[item.review]}
          </span>
          <span>{authorship(item)}</span>
          {item.model ? <span>{item.model}</span> : null}
          <span>v{item.version}</span>
          <time dateTime={item.created_at}>{relativeTime(item.created_at)}</time>
        </span>
        <span className={styles.rowGates}>
          <GateBadges artifact={item} thresholds={thresholds} compact />
        </span>
      </button>
    </li>
  );
});

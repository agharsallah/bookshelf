/**
 * The focused queue item, read in place: gates and verbs in the tool's voice above,
 * what approval triggers, and the body on a sheet below. Queue items come without
 * bodies, so the sheet shows this one's once `loadBody` has it.
 */
import { navigate } from 'astro:transitions/client';
import { useEffect, useState } from 'react';
import { anchorLabel } from '../../../lib/anchors';
import type { ArtifactListItem, ArtifactPublic } from '../../../lib/api/types/artifacts';
import type { SkillGates } from '../../../lib/api/types/skills';
import { ArtifactBody } from '../body/ArtifactBody';
import { GateBadges } from '../GateBadges';
import { propagationNote, TYPE_LABELS } from '../labels';
import styles from './Queue.module.css';

type Body = ArtifactPublic['body'];

export interface ArtifactPreviewProps {
  item: ArtifactListItem;
  loadBody: (id: string) => Promise<Body>;
  heading: string | undefined;
  documentTitle: string;
  thresholds: SkillGates | null | undefined;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onEdit: () => void;
}

export function reviewHref(id: string, params?: Record<string, string>): string {
  const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
  return `/review/${id}${qs}`;
}

/** The item's body: null while it loads, `failed` when it could not be fetched. */
function useBody(id: string, loadBody: (id: string) => Promise<Body>): Body | null | 'failed' {
  const [body, setBody] = useState<{ id: string; value: Body | 'failed' } | null>(null);
  useEffect(() => {
    let live = true;
    loadBody(id).then(
      (value) => live && setBody({ id, value }),
      () => live && setBody({ id, value: 'failed' }),
    );
    return () => {
      live = false;
    };
  }, [id, loadBody]);
  return body?.id === id ? body.value : null;
}

export function ArtifactPreview({ item, loadBody, heading, documentTitle, thresholds, busy, onApprove, onReject, onEdit }: ArtifactPreviewProps) {
  const note = propagationNote(item.type);
  const body = useBody(item.id, loadBody);
  return (
    <article className={styles.preview} aria-labelledby="preview-title">
      <header className={styles.previewHead}>
        <p className={`book-title ${styles.previewDoc}`}>{documentTitle}</p>
        <h2 id="preview-title" className={styles.previewTitle}>
          {TYPE_LABELS[item.type]}
          {item.anchor ? <span className={styles.previewAnchor}> {anchorLabel(item.anchor)}</span> : null}
        </h2>
        {heading ? <p className={styles.previewHeading}>{heading}</p> : null}
        <GateBadges artifact={item} thresholds={thresholds} />
      </header>

      <div className={styles.actions}>
        <button type="button" className="btn btn-primary" onClick={onApprove} disabled={busy}>
          Approve <kbd className={styles.kbd}>a</kbd>
        </button>
        <button type="button" className="btn" onClick={onReject} disabled={busy}>
          Reject <kbd className={styles.kbd}>r</kbd>
        </button>
        <button type="button" className="btn" onClick={onEdit}>
          Edit <kbd className={styles.kbd}>e</kbd>
        </button>
        <a className={styles.open} href={reviewHref(item.id)}>
          Open full review <kbd className={styles.kbd}>Enter</kbd>
        </a>
      </div>
      {note ? <p className={styles.propagation}>After approval: {note}</p> : null}

      <div className={styles.sheet} aria-busy={body === null || undefined}>
        {body === 'failed' ? (
          <p className={styles.bodyMissing}>This body could not be loaded. Open the full review to read it.</p>
        ) : body === null ? (
          <div className={styles.bodyLoading} aria-hidden="true">
            <span className="skeleton-bone" />
            <span className="skeleton-bone" />
            <span className="skeleton-bone" />
          </div>
        ) : (
          <ArtifactBody type={item.type} body={body} onCite={(anchor) => void navigate(reviewHref(item.id, { cite: anchor }))} />
        )}
      </div>
    </article>
  );
}

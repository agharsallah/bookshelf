/**
 * What a claim mark opens: the claim(s) the block is evidence for, each with the paper
 * tabs' `ClaimBadge` and `ClaimRelations` (what the shelf's other papers say, linking to
 * their passages; this paper's passages jump in place). The claims' text and counts come
 * from `GET /papers/{ref}/claims`. It hangs beside the mark, closes on Escape or a click
 * elsewhere, and hands focus back to the mark.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { ClaimWithRelations } from '../../../lib/api/types/paperStudy';
import { getPaperClaims } from '../../../lib/papers/claims-api';
import { problemOf } from '../../common/Problem';
import { ClaimBadge } from '../../papers/ClaimBadge';
import { ClaimRelations } from '../../papers/ClaimRelations';
import type { BlockClaims } from './claimMarks';
import styles from './Paper.module.css';

export interface ClaimPopoverProps {
  block: BlockClaims;
  document: { id: string; slug: string };
  /** The mark it opened from: where it hangs, and where focus returns. */
  opener: HTMLElement;
  onCite: (anchor: string) => void;
  onClose: () => void;
  api?: Pick<ApiClient, 'get' | 'patch' | 'post'>;
}

type Loaded = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; claims: ClaimWithRelations[] };

const WIDTH = 384;

function place(opener: HTMLElement): CSSProperties {
  const rect = opener.getBoundingClientRect();
  const width = Math.min(WIDTH, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.right + 8, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(rect.top - 8, window.innerHeight - 280));
  return { left, top, width };
}

export function ClaimPopover({ block, document: doc, opener, onCite, onClose, api = browserApi }: ClaimPopoverProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [style, setStyle] = useState<CSSProperties>({});
  const panel = useRef<HTMLDivElement>(null);
  const ids = block.claims.map((c) => c.id).join(',');

  useEffect(() => {
    let live = true;
    const wanted = ids.split(',');
    getPaperClaims(api, doc.slug)
      .then((data) => {
        const byId = new Map(data.units.flatMap((u) => u.claims).map((c) => [c.id, c]));
        const claims = wanted.map((id) => byId.get(id)).filter((c): c is ClaimWithRelations => c !== undefined);
        if (live) setLoaded({ state: 'ready', claims });
      })
      .catch((error: unknown) => live && setLoaded({ state: 'failed', message: problemOf(error).message }));
    return () => {
      live = false;
    };
  }, [api, ids, doc.slug]);

  useLayoutEffect(() => {
    setStyle(place(opener));
    panel.current?.focus();
  }, [opener]);

  useEffect(() => {
    const close = () => {
      onClose();
      opener.focus({ preventScroll: true });
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !opener.contains(target)) onClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [onClose, opener]);

  return (
    <div ref={panel} className={styles.claimPopover} style={style} role="dialog" aria-label="Claims resting on this passage" tabIndex={-1}>
      {loaded.state === 'loading' ? <p className={styles.quiet}>Loading the claims…</p> : null}
      {loaded.state === 'failed' ? <p className={styles.error}>The claims could not be loaded: {loaded.message}</p> : null}
      {loaded.state === 'ready' && loaded.claims.length === 0 ? <p className={styles.quiet}>These claims are no longer in the approved claim set.</p> : null}
      {loaded.state === 'ready'
        ? loaded.claims.map((claim) => (
            <article key={claim.id} className={styles.claim}>
              <ClaimBadge claimKey={claim.key} kind={claim.kind} strength={claim.strength} />
              <p className={styles.claimText}>{claim.text}</p>
              <ClaimRelations claimId={claim.id} counts={claim.relations} onCite={onCite} documentId={doc.id} api={api} />
            </article>
          ))
        : null}
    </div>
  );
}

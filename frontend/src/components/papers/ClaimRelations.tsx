/**
 * How the rest of your shelf bears on one claim: the counts in a line ("supported by 1 ·
 * contradicted by 2 on your shelf"), opening onto each relation — the other paper's
 * claim, the passages on both sides, and, while it is only proposed, Accept / Reject
 * (`PATCH /edges/{id}`). Loads `GET /claims/{id}/relations` on first open.
 *
 * Exported for the reader's claim margin marks as well as the claims tab.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { Passage } from '../../lib/api/types/graph';
import type { ClaimRelation, ClaimRelationCounts } from '../../lib/api/types/paperStudy';
import { anchorLabel } from '../../lib/anchors';
import { getClaimRelations, reviewRelation } from '../../lib/papers/claims-api';
import { problemOf } from '../common/Problem';
import { ClaimBadge } from './ClaimBadge';
import { hasRelations, relationPhrase, relationSummary } from './claims';
import { paperHref } from './tabs';
import styles from './Claims.module.css';

export interface ClaimRelationsProps {
  claimId: string;
  counts: ClaimRelationCounts;
  /** Opens a passage of this claim's own paper in place; other papers' passages are links. */
  onCite?: (anchor: string) => void;
  /** This claim's paper: its passages open in place through `onCite`. */
  documentId?: string;
  api?: Pick<ApiClient, 'get' | 'patch' | 'post'>;
}

type Loaded = { state: 'idle' } | { state: 'loading' } | { state: 'ready'; relations: ClaimRelation[] } | { state: 'failed'; message: string };

function PassageLink({ passage, own, onCite }: { passage: Passage; own: boolean; onCite?: ((anchor: string) => void) | undefined }) {
  const slug = passage.document?.slug;
  const label = `${passage.heading ? `${passage.heading}, ` : ''}${anchorLabel(passage.anchor)}`;
  const href = slug ? `/documents/${slug}/read/${passage.anchor}` : undefined;
  return (
    <li className={styles.passage} data-own={own || undefined}>
      <a
        href={href}
        onClick={(event) => {
          if (!own || !onCite || event.metaKey || event.ctrlKey || event.button !== 0) return;
          event.preventDefault();
          onCite(passage.anchor);
        }}
      >
        {own ? 'This paper' : (passage.document?.title ?? 'The other paper')}, {label}
      </a>
      {passage.snippet ? <q>{passage.snippet}</q> : null}
    </li>
  );
}

export function ClaimRelations({ claimId, counts, onCite, documentId, api = browserApi }: ClaimRelationsProps) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({ state: 'idle' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const summary = relationSummary(counts);
  if (!hasRelations(counts)) return <p className={styles.noRelations}>Nothing on your shelf bears on it yet.</p>;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next || loaded.state === 'ready' || loaded.state === 'loading') return;
    setLoaded({ state: 'loading' });
    try {
      setLoaded({ state: 'ready', relations: (await getClaimRelations(api, claimId)).relations });
    } catch (problem) {
      setLoaded({ state: 'failed', message: problemOf(problem).message });
    }
  };

  const decide = async (rel: ClaimRelation, status: 'accepted' | 'rejected') => {
    if (loaded.state !== 'ready') return;
    setBusy(rel.edge_id);
    setError(null);
    try {
      await reviewRelation(api, rel.edge_id, status);
      const rest = loaded.relations.filter((r) => r.edge_id !== rel.edge_id);
      setLoaded({ state: 'ready', relations: status === 'rejected' ? rest : [{ ...rel, status }, ...rest] });
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setBusy(null);
    }
  };

  const panelId = `relations-${claimId}`;
  return (
    <div className={styles.relations}>
      <button type="button" className={styles.relationsToggle} aria-expanded={open} aria-controls={panelId} onClick={() => void toggle()}>
        <span aria-hidden="true" className={styles.caret} />
        {summary ?? 'Related claims on your shelf'}
        {counts.proposed > 0 ? <span className={styles.proposedCount}>{counts.proposed} to review</span> : null}
      </button>
      {open ? (
        <div id={panelId} className={styles.relationList}>
          {loaded.state === 'loading' ? <p className={styles.noRelations}>Loading…</p> : null}
          {loaded.state === 'failed' ? <p className={styles.error}>Could not load them: {loaded.message}</p> : null}
          {loaded.state === 'ready' && loaded.relations.length === 0 ? <p className={styles.noRelations}>No relations left.</p> : null}
          {loaded.state === 'ready' ? (
            <ul>
              {loaded.relations.map((rel) => {
                const phrase = relationPhrase(rel);
                const other = rel.other_document;
                return (
                  <li key={rel.edge_id} className={styles.relation} data-tone={phrase.tone} data-status={rel.status}>
                    <p className={styles.relationHead}>
                      <span className={styles.relationWord}>{phrase.text}</span>
                      {other ? <a href={paperHref(other.slug, 'claims')}>{other.title}</a> : <span>another paper</span>}
                      {rel.status === 'proposed' ? <span className={styles.proposedCount}>Proposed</span> : null}
                    </p>
                    <blockquote className={styles.otherClaim}>
                      <ClaimBadge claimKey={rel.other.key} kind={rel.other.kind} strength={rel.other.strength} />
                      <p>{rel.other.text}</p>
                    </blockquote>
                    {rel.rationale ? <p className={styles.rationale}>{rel.rationale}</p> : null}
                    {rel.evidence.length > 0 ? (
                      <ul className={styles.passages} aria-label="Evidence">
                        {rel.evidence.map((p) => (
                          <PassageLink key={p.ref} passage={p} own={documentId !== undefined && p.document?.id === documentId} onCite={onCite} />
                        ))}
                      </ul>
                    ) : null}
                    {rel.status === 'proposed' ? (
                      <p className={styles.decide}>
                        <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => void decide(rel, 'accepted')}>
                          Accept
                        </button>
                        <button type="button" className="btn" disabled={busy !== null} onClick={() => void decide(rel, 'rejected')}>
                          Reject
                        </button>
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {error ? <p className={styles.error}>Could not save it: {error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export default ClaimRelations;

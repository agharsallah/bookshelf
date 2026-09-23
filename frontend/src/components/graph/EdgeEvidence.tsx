/**
 * An edge's case: the claim in words ("Feedback loop supports Delays"), its status and
 * origin, and every evidence passage with a link into the reader. A folded edge (a book
 * focus folds its passages) loads each underlying edge. Proposed edges can be accepted
 * or rejected here; an edge you cannot verify is a liability (§11).
 */
import { useEffect, useState } from 'react';
import { Problem, problemOf, type ProblemInfo } from '../document/Problem';
import type { ApiClient } from '../../lib/api/client';
import type { EdgeDetail, EdgeStatus } from '../../lib/api/types/graph';
import { PassageList } from '../concepts/PassageList';
import type { ModelEdge } from './model';
import { RelationMark } from './Legend';
import { RELATION_STYLES } from './styles';
import styles from './Graph.module.css';

const MAX_FOLDED = 6;

export interface EdgeEvidenceProps {
  api: ApiClient;
  edge: ModelEdge;
  onChanged: () => void;
}

export function EdgeEvidence({ api, edge, onChanged }: EdgeEvidenceProps) {
  const [details, setDetails] = useState<EdgeDetail[] | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = (edge.data.edge_ids.length ? edge.data.edge_ids : [edge.id]).slice(0, MAX_FOLDED);
  const key = ids.join(',');

  useEffect(() => {
    let live = true;
    setDetails(null);
    setProblem(null);
    Promise.all(key.split(',').map((id) => api.get<EdgeDetail>(`edges/${id}`)))
      .then((all) => live && setDetails(all))
      .catch((error: unknown) => live && setProblem(problemOf(error)));
    return () => {
      live = false;
    };
  }, [api, key]);

  const setStatus = async (status: EdgeStatus) => {
    setSaving(true);
    try {
      await Promise.all(key.split(',').map((id) => api.patch(`edges/${id}`, { status })));
      onChanged();
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSaving(false);
    }
  };

  const first = details?.[0];
  const style = RELATION_STYLES[edge.relation];
  const passages = details?.flatMap((d) => d.evidence) ?? [];
  return (
    <div className={styles.panelBody}>
      <p className={styles.panelKind}>
        <RelationMark relation={edge.relation} proposed={edge.status === 'proposed'} />
        {style.label}
        {edge.status === 'proposed' ? <span className={styles.proposed}>proposed</span> : null}
      </p>
      {first ? (
        <h2 className={styles.panelTitle}>
          {first.src.label} <em className={styles.verb}>{style.verb}</em> {first.dst.label}
        </h2>
      ) : (
        <h2 className={styles.panelTitle}>Loading the evidence…</h2>
      )}
      {problem ? <Problem inline title="The evidence could not be loaded." problem={problem} /> : null}
      {first ? (
        <p className={styles.panelMeta}>
          {first.origin === 'human' ? 'Drawn by you' : 'Proposed by a skill'}, weight {edge.data.weight.toFixed(2)}
          {ids.length > 1 ? `, folded from ${edge.data.edge_ids.length} passage links` : ''}
        </p>
      ) : null}
      {edge.status === 'proposed' ? (
        <div className={styles.panelActions}>
          <button type="button" className={styles.action} disabled={saving} onClick={() => setStatus('accepted')}>
            Accept
          </button>
          <button type="button" className={styles.actionQuiet} disabled={saving} onClick={() => setStatus('rejected')}>
            Reject
          </button>
        </div>
      ) : null}
      {details ? (
        passages.length ? (
          <PassageList passages={passages} />
        ) : (
          <p className={styles.panelMeta}>No evidence passages are recorded for this edge.</p>
        )
      ) : null}
    </div>
  );
}

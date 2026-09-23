/**
 * Merge proposals, one decision at a time: the two concepts side by side with how alike
 * they are and why the model thinks so; choose which name survives, then Merge, Reject
 * or Skip. Merge and Reject can be undone from the toast (unmerge / back to proposed).
 * Keys on the current proposal: M merge · R reject · S skip.
 */
import { useReducer, useState, type KeyboardEvent } from 'react';
import { problemOf } from '../common/Problem';
import { Toaster, useToasts } from '../review/common/Toasts';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { ConceptSummary, MergeProposal } from '../../lib/api/types/graph';
import { conceptHref } from '../search/links';
import { defaultSurvivor, mergePlan, mergeQueueReducer, similarityLabel } from './merge-model';
import { PassageList } from './PassageList';
import styles from './Merge.module.css';

export interface MergeQueueProps {
  proposals: MergeProposal[];
  api?: ApiClient;
}

function Side({ concept, chosen, name, onChoose }: { concept: ConceptSummary; chosen: boolean; name: string; onChoose: () => void }) {
  return (
    <label className={styles.side} data-chosen={chosen || undefined}>
      <span className={styles.keep}>
        <input type="radio" name={name} checked={chosen} onChange={onChoose} aria-label={`Keep “${concept.canonical}”`} />
        {chosen ? 'Keeps its name' : 'Keep this name'}
      </span>
      <a className={styles.name} href={conceptHref(concept.id)}>
        {concept.canonical}
      </a>
      <span className={styles.meta}>
        {concept.kind}
        {concept.origin === 'human' ? ', curated by you' : ''}
      </span>
      {concept.aliases.length ? <span className={styles.aliases}>Also {concept.aliases.join(', ')}</span> : null}
      {concept.blurb ? <span className={styles.blurb}>{concept.blurb}</span> : <span className={styles.meta}>No gloss yet.</span>}
    </label>
  );
}

export function MergeQueue({ proposals, api = browserApi }: MergeQueueProps) {
  const [state, dispatch] = useReducer(mergeQueueReducer, { items: proposals });
  const [survivors, setSurvivors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const { toasts, push, dismiss } = useToasts(8000);

  const survivorOf = (p: MergeProposal) => survivors[p.edge_id] ?? defaultSurvivor(p);
  const fail = (title: string, error: unknown) => push({ id: `err-${Date.now()}`, tone: 'error', message: `${title} ${problemOf(error).message}` });

  const merge = async (p: MergeProposal) => {
    const index = state.items.indexOf(p);
    const { loser, survivor } = mergePlan(p, survivorOf(p));
    setBusy(p.edge_id);
    try {
      await api.post(`concepts/${loser.id}/merge`, { into: survivor.id });
      dispatch({ type: 'resolve', edgeId: p.edge_id });
      push({
        id: p.edge_id,
        tone: 'ok',
        message: `Merged “${loser.canonical}” into “${survivor.canonical}”.`,
        undo: () => {
          api
            .post(`concepts/${loser.id}/unmerge`)
            .then(() => dispatch({ type: 'restore', proposal: p, index }))
            .catch((error: unknown) => fail('The merge could not be undone.', error));
        },
      });
    } catch (error) {
      fail('The merge failed.', error);
    } finally {
      setBusy(null);
    }
  };

  const reject = async (p: MergeProposal) => {
    const index = state.items.indexOf(p);
    setBusy(p.edge_id);
    try {
      await api.patch(`edges/${p.edge_id}`, { status: 'rejected' });
      dispatch({ type: 'resolve', edgeId: p.edge_id });
      push({
        id: p.edge_id,
        tone: 'info',
        message: `Rejected: “${p.a.canonical}” and “${p.b.canonical}” stay apart.`,
        undo: () => {
          api
            .patch(`edges/${p.edge_id}`, { status: 'proposed' })
            .then(() => dispatch({ type: 'restore', proposal: p, index }))
            .catch((error: unknown) => fail('The rejection could not be undone.', error));
        },
      });
    } catch (error) {
      fail('The rejection failed.', error);
    } finally {
      setBusy(null);
    }
  };

  const onKey = (p: MergeProposal) => (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement && event.target.type !== 'radio') return;
    if (event.metaKey || event.ctrlKey || event.altKey || busy) return;
    const key = event.key.toLowerCase();
    if (key === 'm') void merge(p);
    else if (key === 'r') void reject(p);
    else if (key === 's') dispatch({ type: 'skip', edgeId: p.edge_id });
    else return;
    event.preventDefault();
  };

  return (
    <div className={styles.queue}>
      {state.items.length === 0 ? (
        <p className={styles.empty}>No merges are waiting. When the dedup pass finds two names for one idea, it asks you here.</p>
      ) : (
        <ol className={styles.list}>
          {state.items.map((p) => {
            const chosen = survivorOf(p);
            const similarity = similarityLabel(p.similarity);
            return (
              <li key={p.edge_id}>
                <article className={styles.proposal} tabIndex={0} onKeyDown={onKey(p)} aria-label={`${p.a.canonical} or ${p.b.canonical}`} aria-busy={busy === p.edge_id}>
                  <div className={styles.pair}>
                    <Side concept={p.a} name={`survivor-${p.edge_id}`} chosen={chosen === p.a.id} onChoose={() => setSurvivors((s) => ({ ...s, [p.edge_id]: p.a.id }))} />
                    <div className={styles.between}>
                      <span className={styles.equals} aria-hidden="true">=</span>
                      {similarity ? <span>{similarity}</span> : null}
                      {p.confidence ? <span>{p.confidence} confidence</span> : null}
                    </div>
                    <Side concept={p.b} name={`survivor-${p.edge_id}`} chosen={chosen === p.b.id} onChoose={() => setSurvivors((s) => ({ ...s, [p.edge_id]: p.b.id }))} />
                  </div>
                  {p.rationale ? <blockquote className={styles.rationale}>{p.rationale}</blockquote> : null}
                  {p.evidence.length ? (
                    <details className={styles.evidence}>
                      <summary>{p.evidence.length === 1 ? '1 passage' : `${p.evidence.length} passages`}</summary>
                      <PassageList passages={p.evidence} />
                    </details>
                  ) : null}
                  <div className={styles.actions}>
                    <button type="button" className={styles.merge} disabled={busy !== null} onClick={() => void merge(p)}>
                      Merge
                    </button>
                    <button type="button" className={styles.reject} disabled={busy !== null} onClick={() => void reject(p)}>
                      Reject
                    </button>
                    <button type="button" className={styles.skip} disabled={busy !== null || state.items.length < 2} onClick={() => dispatch({ type: 'skip', edgeId: p.edge_id })}>
                      Skip
                    </button>
                    <span className={styles.keys} aria-hidden="true">
                      M, R, S
                    </span>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      )}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default MergeQueue;

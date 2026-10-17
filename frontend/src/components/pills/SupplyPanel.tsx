/**
 * Supply (workshop mode only, `workshop-only`): how many unseen pills each document has,
 * the chapters `make-pills` could still run on, each with its token estimate and a
 * "Make pills" button, and the documents with no distillation yet, by name, since nothing
 * can be made from them.
 */
import { useState } from 'react';
import type { GenerateResult, Supply } from '../../lib/pills/types';
import { problemOf } from '../common/Problem';
import { chapterLabel } from '../guide/guide';
import { WORKSHOP_ONLY } from '../../lib/workshop';
import styles from './SupplyPanel.module.css';

export interface SupplyPanelProps {
  supply: Supply | null;
  onGenerate: (documentId: string, anchor: string) => Promise<GenerateResult>;
}

type Made = { state: 'busy' } | { state: 'queued' } | { state: 'failed'; message: string };

/** The unit's own heading (a paper's carry their numbers), else "Chapter 4". */
const chapterName = (anchor: string, title: string | null) => {
  if (title) return title;
  const label = chapterLabel(anchor);
  return /^\d+$/.test(label) ? `Chapter ${label}` : label;
};

/** "about 12.4k tokens", or a plain "no estimate yet" before any make-pills run. */
const estimateLabel = (n: number | null) =>
  n === null ? 'no estimate yet' : `about ${n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)} tokens`;

export function SupplyPanel({ supply, onGenerate }: SupplyPanelProps) {
  const [made, setMade] = useState<Record<string, Made>>({});
  if (!supply) return null;
  const undistilled = supply.by_document.filter((d) => d.undistilled);
  const stocked = supply.by_document.filter((d) => !d.undistilled);

  const make = async (documentId: string, anchor: string) => {
    const key = `${documentId}:${anchor}`;
    setMade((m) => ({ ...m, [key]: { state: 'busy' } }));
    try {
      await onGenerate(documentId, anchor);
      setMade((m) => ({ ...m, [key]: { state: 'queued' } }));
    } catch (error) {
      setMade((m) => ({ ...m, [key]: { state: 'failed', message: problemOf(error).message } }));
    }
  };

  return (
    <section className={`${WORKSHOP_ONLY} ${styles.supply}`} aria-labelledby="pills-supply-title">
      <h2 id="pills-supply-title">
        Supply <span className={styles.total}>{supply.unseen} unseen</span>
        {supply.low ? <span className={styles.low}>running low</span> : null}
      </h2>
      {stocked.length > 0 ? (
        <ul className={styles.docs}>
          {stocked.map(({ document, unseen, generatable }) => (
            <li key={document.id}>
              <p className={styles.doc}>
                <a href={`/documents/${encodeURIComponent(document.slug)}`}>{document.title}</a>
                <span>{unseen} unseen</span>
              </p>
              {generatable.length > 0 ? (
                <ul className={styles.chapters}>
                  {generatable.map(({ anchor, title, estimate_tokens }) => {
                    const status = made[`${document.id}:${anchor}`];
                    return (
                      <li key={anchor}>
                        <span className={styles.chapter}>{chapterName(anchor, title)}</span>
                        <span className={styles.estimate}>{estimateLabel(estimate_tokens)}</span>
                        {status?.state === 'queued' ? (
                          <span className={styles.queued}>Queued</span>
                        ) : (
                          <button type="button" className="btn btn-quiet" data-demo-off disabled={status?.state === 'busy'} onClick={() => void make(document.id, anchor)}>
                            Make pills
                          </button>
                        )}
                        {status?.state === 'failed' ? (
                          <span className={styles.failed} role="alert">
                            {status.message}
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {undistilled.length > 0 ? (
        <p className={styles.undistilled}>
          No distillation yet, so no pills: {undistilled.map((d) => d.document.title).join(', ')}.
        </p>
      ) : null}
    </section>
  );
}

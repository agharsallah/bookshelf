/**
 * The cited answer, as it streams: the stage it is at, then the answer set with
 * `<Blocks>` (cite chips link into the reader, lettered per book), then its sources.
 */
import { useMemo } from 'react';
import { Blocks } from '../blocks';
import { Problem } from '../common/Problem';
import { anchorLabel } from '../../lib/anchors';
import { collectCites } from '../../lib/contract';
import type { AnswerStage } from '../../lib/api/types/search';
import { indexCites } from './cites';
import type { AnswerState } from './answer';
import styles from './Answer.module.css';

const STAGES: { stage: AnswerStage; label: string }[] = [
  { stage: 'routing', label: 'Reading the question' },
  { stage: 'searching', label: 'Finding passages' },
  { stage: 'writing', label: 'Writing the answer' },
];

export interface AnswerPanelProps {
  state: Exclude<AnswerState, { phase: 'idle' }>;
  onCancel: () => void;
  onRetry: () => void;
  onClose: () => void;
}

function Progress({ stage, message }: { stage: AnswerStage | null; message: string | null }) {
  const at = stage ? STAGES.findIndex((s) => s.stage === stage) : -1;
  return (
    <div className={styles.progress}>
      <ol className={styles.stages} aria-hidden="true">
        {STAGES.map((s, i) => (
          <li key={s.stage} data-state={i < at ? 'done' : i === at ? 'now' : 'later'}>
            {s.label}
          </li>
        ))}
      </ol>
      <p className={styles.status} role="status">
        {message ?? 'Opening the question…'}
      </p>
    </div>
  );
}

function Answer({ state }: { state: Extract<AnswerState, { phase: 'done' }> }) {
  const { blocks, sources, dropped_cites } = state.answer;
  const index = useMemo(() => indexCites(sources, collectCites(blocks)), [sources, blocks]);
  return (
    <>
      <div className={styles.body}>
        <Blocks blocks={blocks} citeHref={index.href} citeLabel={index.label} citeTitle={index.title} />
      </div>
      {index.documents.length > 0 ? (
        <section className={styles.sources} aria-label="Sources">
          <h3>Sources</h3>
          <ul>
            {index.documents.map((doc) => (
              <li key={doc.document.id}>
                {index.documents.length > 1 ? <span className={styles.siglum}>{doc.siglum}</span> : null}
                <span className={styles.sourceTitle}>{doc.document.title}</span>
                <span className={styles.sourceCites}>
                  {doc.cites.map((c) => (
                    <a key={c.key} href={c.href} title={c.anchor}>
                      {anchorLabel(c.anchor)}
                    </a>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {dropped_cites.length > 0 ? (
        <p className={styles.note}>
          {dropped_cites.length === 1 ? 'One citation' : `${dropped_cites.length} citations`} pointed outside the passages the answer
          was given and {dropped_cites.length === 1 ? 'was' : 'were'} removed.
        </p>
      ) : null}
    </>
  );
}

export function AnswerPanel({ state, onCancel, onRetry, onClose }: AnswerPanelProps) {
  const streaming = state.phase === 'streaming';
  return (
    <section className={styles.panel} aria-label="Answer" aria-busy={streaming}>
      <header className={styles.head}>
        <h2 className={styles.question}>{state.question}</h2>
        <div className={styles.actions}>
          {streaming ? (
            <button type="button" className={styles.button} onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button type="button" className={styles.quiet} onClick={onClose} aria-label="Close the answer">
              Close
            </button>
          )}
        </div>
      </header>

      {state.phase === 'streaming' ? <Progress stage={state.status?.stage ?? null} message={state.status?.message ?? null} /> : null}
      {state.phase === 'done' ? <Answer state={state} /> : null}
      {state.phase === 'cancelled' ? (
        <p className={styles.note}>
          Stopped.{' '}
          <button type="button" className={styles.link} onClick={onRetry}>
            Ask again
          </button>
        </p>
      ) : null}
      {state.phase === 'error' ? (
        <div className={styles.error}>
          <Problem
            inline
            title={state.error.code === 'no_evidence' ? 'Nothing in the library answers this yet.' : 'The answer could not be written.'}
            problem={{ message: state.error.message, code: state.error.code, requestId: state.error.requestId, status: 0 }}
          />
          <button type="button" className={styles.link} onClick={onRetry}>
            Ask again
          </button>
        </div>
      ) : null}
    </section>
  );
}

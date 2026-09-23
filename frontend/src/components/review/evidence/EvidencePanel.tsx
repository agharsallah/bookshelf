/**
 * Side-by-side evidence: the source passage(s) a cite points at, fetched on demand from
 * `GET /documents/{id}/blocks?anchor_prefix=` and kept next to the claim being checked.
 */
import { useEffect, useRef, useState } from 'react';
import { anchorLabel } from '../../../lib/anchors';
import { problemOf, Problem, type ProblemInfo } from '../../common/Problem';
import type { SourceBlock } from '../api';
import styles from './EvidencePanel.module.css';

const SHOWN = 12;

type Load = { state: 'idle' } | { state: 'loading' } | { state: 'error'; problem: ProblemInfo } | { state: 'done'; blocks: SourceBlock[] };

export interface EvidencePanelProps {
  anchor: string | null;
  lookup: (anchor: string) => Promise<SourceBlock[]>;
  onClose?: () => void;
}

function Passage({ block }: { block: SourceBlock }) {
  const pages = block.page_from ? (block.page_to && block.page_to !== block.page_from ? `pp. ${block.page_from}–${block.page_to}` : `p. ${block.page_from}`) : null;
  const caption = typeof block.meta.caption === 'string' ? block.meta.caption : null;
  return (
    <li className={styles.passage} data-kind={block.kind}>
      <p className={styles.where}>
        <span className={styles.anchor}>{block.anchor}</span>
        <span>{block.kind}</span>
        {pages ? <span>{pages}</span> : null}
      </p>
      {caption ? <p className={styles.caption}>{caption}</p> : null}
      <p className={block.kind === 'code' ? styles.code : styles.text}>{block.text ?? block.heading ?? '(no text)'}</p>
    </li>
  );
}

export function EvidencePanel({ anchor, lookup, onClose }: EvidencePanelProps) {
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!anchor) {
      setLoad({ state: 'idle' });
      return;
    }
    let live = true;
    setLoad({ state: 'loading' });
    lookup(anchor).then(
      (blocks) => live && setLoad({ state: 'done', blocks }),
      (error: unknown) => live && setLoad({ state: 'error', problem: problemOf(error) }),
    );
    heading.current?.focus();
    return () => {
      live = false;
    };
  }, [anchor, lookup]);

  return (
    <aside className={styles.panel} aria-labelledby="evidence-title">
      <div className={styles.head}>
        <h2 id="evidence-title" ref={heading} tabIndex={-1} className={styles.title}>
          {anchor ? `Source ${anchorLabel(anchor)}` : 'Source'}
        </h2>
        {anchor && onClose ? (
          <button type="button" className={styles.close} onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>
      <div aria-live="polite" aria-busy={load.state === 'loading'}>
        {load.state === 'idle' ? (
          <p className={styles.hint}>Select a citation to read the passage it points at, next to the claim.</p>
        ) : null}
        {load.state === 'loading' ? <p className={styles.hint}>Loading {anchor}…</p> : null}
        {load.state === 'error' ? <Problem title="The passage could not be loaded." problem={load.problem} inline /> : null}
        {load.state === 'done' && load.blocks.length === 0 ? (
          <p className={styles.hint}>No block has the anchor {anchor}. The cite may point at a passage that a re-parse removed.</p>
        ) : null}
        {load.state === 'done' && load.blocks.length > 0 ? (
          <ol className={styles.passages}>
            {load.blocks.slice(0, SHOWN).map((block) => (
              <Passage key={block.id} block={block} />
            ))}
            {load.blocks.length > SHOWN ? <li className={styles.hint}>and {load.blocks.length - SHOWN} more blocks under {anchor}</li> : null}
          </ol>
        ) : null}
      </div>
    </aside>
  );
}

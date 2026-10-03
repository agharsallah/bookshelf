/**
 * Documents and their stage tracks. A long shelf shows only what is worth watching by
 * default: documents with work queued, running or failed ("Active"); "All" lists every
 * one, a page at a time. Filters narrow it to the documents of the matching jobs. With
 * `onFirst`, each document can be put first in the queue (or taken out of first).
 */
import { useState } from 'react';
import type { JobPublic } from '../../lib/api/types/jobs';
import type { DocumentLabel } from '../review/api';
import { activeDocumentIds } from './filters';
import { stageProgress } from './model';
import { ShowMore, useShowMore } from './ShowMore';
import { StageTrack } from './StageTrack';
import styles from './Pipeline.module.css';

const PAGE = 8;

export interface DocumentsPanelProps {
  documents: readonly DocumentLabel[];
  /** Every job loaded: the stage tracks and "Active" read from all of them. */
  jobs: readonly JobPublic[];
  /** The jobs the filters match, or null when nothing is filtered. */
  matching: readonly JobPublic[] | null;
  /** Books whose jobs go first (`QueueStatus.first_documents`). */
  first?: readonly string[] | null;
  /** Set which books go first; leave out to offer no toggle. */
  onFirst?: (ids: string[]) => void;
}

type Scope = 'active' | 'all';

export function DocumentsPanel({ documents, jobs, matching, first = null, onFirst }: DocumentsPanelProps) {
  const firstIds = first ?? [];
  const active = activeDocumentIds(jobs);
  const [chosen, setScope] = useState<Scope | null>(null);
  const scope: Scope = chosen ?? (active.size > 0 ? 'active' : 'all');
  const page = useShowMore(PAGE);
  const matched = matching ? new Set(matching.map((j) => j.document_id)) : null;
  const inView = documents.filter((d) => (!matched || matched.has(d.id)) && (scope === 'all' || active.has(d.id)));
  const shown = inView.slice(0, page.limit);

  return (
    <section aria-labelledby="docs-title" className={styles.docs}>
      <div className={styles.sectionHead}>
        <h2 id="docs-title" className={styles.sectionTitle}>
          Documents <span className={styles.count}>{inView.length}</span>
        </h2>
        <div className={styles.segmented} role="group" aria-label="Which documents">
          <button type="button" aria-pressed={scope === 'active'} onClick={() => setScope('active')}>
            Active {active.size}
          </button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            All {documents.length}
          </button>
        </div>
      </div>
      {documents.length === 0 ? <p className={styles.muted}>No documents yet. Ingest one from the library.</p> : null}
      {documents.length > 0 && inView.length === 0 ? (
        <p className={styles.muted}>{scope === 'active' ? 'No document has work queued, running or failed.' : 'No document matches the filters.'}</p>
      ) : null}
      <ul className={styles.docList}>
        {shown.map((doc) => (
          <li key={doc.id} className={styles.doc}>
            <p className={styles.docHead}>
              <a href={`/documents/${doc.slug}`} className={`book-title ${styles.docTitle}`}>
                {doc.title}
              </a>
              <span className={styles.docStatus}>{doc.status?.replaceAll('_', ' ')}</span>
              {onFirst ? (
                <button
                  type="button"
                  className={styles.firstToggle}
                  aria-pressed={firstIds.includes(doc.id)}
                  aria-label={`${firstIds.includes(doc.id) ? 'Stop putting' : 'Put'} ${doc.title} first in the queue`}
                  onClick={() => onFirst(firstIds.includes(doc.id) ? firstIds.filter((id) => id !== doc.id) : [...firstIds, doc.id])}
                >
                  {firstIds.includes(doc.id) ? 'First ✓' : 'Put first'}
                </button>
              ) : null}
            </p>
            <StageTrack label={doc.title} stages={stageProgress(doc.status ?? '', jobs.filter((j) => j.document_id === doc.id))} />
          </li>
        ))}
      </ul>
      <ShowMore shown={shown.length} total={inView.length} step={PAGE} noun="documents" onMore={page.more} onAll={page.all} />
    </section>
  );
}

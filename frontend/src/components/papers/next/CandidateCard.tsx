/**
 * One paper in the reading queue: rank, title, authors, where and when, how often it is
 * cited; the model's reason with cites into the shelf paper that leads to it; how it was
 * found; why it scores as it does; and what you can do with it. "Add to shelf" fetches the
 * PDF (a `paper_fetch` job) and, once done, links to the new paper.
 */
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { ReadingCandidatePublic } from '../../../lib/api/types/papers';
import { ingestCandidate } from '../../../lib/papers/api';
import { authorLine, venueLine } from '../labels';
import { canIngest, fetchedDocument, movesFor, reasonCites, sourceChips, STATUS_LABELS, type CandidateMove, type ShelfIndex } from './candidates';
import { ScoreBreakdown } from './ScoreBreakdown';
import { useJobRun } from '../useJobRun';
import styles from './Next.module.css';

const MOVE_LABELS: Record<CandidateMove, string> = {
  queue: 'Queue',
  unqueue: 'Unqueue',
  dismiss: 'Dismiss',
  restore: 'Restore',
};

export interface CandidateCardProps {
  candidate: ReadingCandidatePublic;
  rank: number;
  shelf: ShelfIndex;
  scale: number;
  busy: boolean;
  error: string | null;
  onMove: (move: CandidateMove) => void;
  api?: Pick<ApiClient, 'post' | 'put' | 'patch' | 'delete'>;
}

const count = new Intl.NumberFormat('en');

/** Shelf papers behind a chip, short: the first title clipped, then how many more. */
function viaLine(titles: readonly string[]): string {
  const first = titles[0] ?? '';
  const clipped = first.length > 48 ? `${first.slice(0, 47)}…` : first;
  return titles.length > 1 ? `${clipped} and ${titles.length - 1} more` : clipped;
}

export function CandidateCard({ candidate: c, rank, shelf, scale, busy, error, onMove, api = browserApi }: CandidateCardProps) {
  const fetch = useJobRun(() => ingestCandidate(api, c.id));
  const newDoc = fetch.finished ? fetchedDocument(fetch.job?.result) : null;
  const onShelf = c.status === 'ingested' || newDoc !== null;
  const docId = newDoc ?? c.document_id;
  const where = venueLine(c.venue, c.year);
  const cites = reasonCites(c.reason_cites, shelf);
  const chips = sourceChips(c.sources, shelf);
  const titleId = `candidate-${c.id}`;

  return (
    <article className={styles.card} aria-labelledby={titleId} data-status={onShelf ? 'ingested' : c.status}>
      <span className={styles.rank} aria-hidden="true">
        {rank}
      </span>
      <div className={styles.body}>
        <h2 id={titleId} className={styles.title}>
          {docId && onShelf ? <a href={`/documents/${docId}/paper`}>{c.title}</a> : c.title}
        </h2>
        <p className={styles.byline}>
          {[authorLine(c.authors), where, c.cited_by_count !== null ? `cited by ${count.format(c.cited_by_count)}` : null]
            .filter(Boolean)
            .join(', ')}
        </p>

        {c.reason ? (
          <p className={styles.reason}>
            {c.reason}
            {cites.map((cite) =>
              cite.href ? (
                <a key={cite.cite} className={styles.cite} href={cite.href} title={`Open the passage: ${cite.title}`}>
                  {cite.label}
                </a>
              ) : (
                <span key={cite.cite} className={styles.cite} title={cite.title}>
                  {cite.label}
                </span>
              ),
            )}
          </p>
        ) : null}

        {chips.length ? (
          <ul className={styles.chips} aria-label="How it was found">
            {chips.map((chip) => (
              <li key={chip.kind} data-kind={chip.kind} title={[chip.hint, ...chip.via].join('\n')}>
                {chip.name}
                {chip.via.length ? <span className={styles.via}> {chip.kind === 'cited_by' ? 'cites' : 'via'} {viaLine(chip.via)}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}

        <ScoreBreakdown parts={c.score_parts} score={c.score} scale={scale} />
      </div>

      <div className={styles.actions}>
        {onShelf ? (
          <span className={styles.state}>
            {docId ? (
              <a className="btn" href={`/documents/${docId}/paper`}>
                Open the paper
              </a>
            ) : (
              STATUS_LABELS.ingested
            )}
          </span>
        ) : (
          <>
            {c.status !== 'dismissed' && canIngest(c) ? (
              <button type="button" className="btn btn-primary" disabled={fetch.live || busy} aria-busy={fetch.live || undefined} onClick={() => void fetch.start()}>
                {fetch.live ? 'Adding…' : fetch.progress?.phase === 'failed' ? 'Try adding again' : 'Add to shelf'}
              </button>
            ) : null}
            {movesFor(c.status).map((move) => (
              <button key={move} type="button" className={move === 'dismiss' ? 'btn btn-quiet' : 'btn'} disabled={busy || fetch.live} onClick={() => onMove(move)}>
                {MOVE_LABELS[move]}
              </button>
            ))}
          </>
        )}
        <span className={styles.status} aria-live="polite">
          {fetch.sending ? 'Asking for the PDF…' : fetch.progress && !fetch.finished ? fetch.progress.text : null}
          {fetch.progress?.phase === 'failed' && fetch.job?.error ? <span className={styles.error}>{fetch.job.error.split('\n')[0]?.slice(0, 160)}</span> : null}
          {fetch.error ? <span className={styles.error}>Could not add it: {fetch.error}</span> : null}
          {!canIngest(c) && !onShelf && c.status !== 'dismissed' ? <span className={styles.hint}>No open PDF known</span> : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </span>
      </div>
    </article>
  );
}

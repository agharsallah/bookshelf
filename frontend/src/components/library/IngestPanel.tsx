/**
 * Ingest island: files waiting in `library/` with one-click "Add to shelf", plus
 * "Add an article by URL". Each ingest's parse job is followed live over
 * `/jobs/stream`; a duplicate (409) links to the copy already on the shelf.
 */
import { useCallback, useEffect, useMemo, useState, type SubmitEvent } from 'react';
import { browserApi } from '../../lib/api/client';
import type { Page } from '../../lib/api/types';
import type { LibraryFile } from '../../lib/api/types/documents';
import type { JobState } from '../../lib/api/types/jobs';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { Problem, problemOf, type ProblemInfo } from '../document/Problem';
import { formatSize, ingest, isFinished, jobPhrase, type IngestOutcome } from './ingest';
import styles from './IngestPanel.module.css';

export interface IngestPanelProps {
  /** Files listed at render time; null when the server could not list them. */
  initialFiles: LibraryFile[] | null;
  initialProblem?: ProblemInfo | null;
}

type Pending = IngestOutcome | { kind: 'sending' };

export function IngestPanel({ initialFiles, initialProblem = null }: IngestPanelProps) {
  const [files, setFiles] = useState<LibraryFile[] | null>(initialFiles);
  const [problem, setProblem] = useState<ProblemInfo | null>(initialProblem);
  const [outcomes, setOutcomes] = useState<Record<string, Pending>>({});
  const [url, setUrl] = useState('');

  const [watching, setWatching] = useState(false);
  const { jobs, track } = useJobStream({ enabled: watching });
  const unfinished = useMemo(
    () => Object.values(outcomes).some((o) => o.kind === 'accepted' && !isFinished(jobs[o.jobId]?.state)),
    [outcomes, jobs],
  );
  // Stay connected only while an ingest is still being parsed.
  useEffect(() => setWatching(unfinished), [unfinished]);

  const reload = useCallback(async () => {
    try {
      const page = await browserApi.get<Page<LibraryFile>>('library', { query: { limit: 100 } });
      setFiles(page.items);
      setProblem(null);
    } catch (error) {
      setProblem(problemOf(error));
    }
  }, []);

  useEffect(() => {
    if (initialFiles === null && initialProblem === null) void reload();
  }, [initialFiles, initialProblem, reload]);

  const add = async (key: string, body: { path: string } | { url: string }) => {
    setOutcomes((o) => ({ ...o, [key]: { kind: 'sending' } }));
    const outcome = await ingest(browserApi, body);
    if (outcome.kind === 'accepted') track(outcome.job);
    setOutcomes((o) => ({ ...o, [key]: outcome }));
  };

  const submitUrl = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;
    void add(`url:${value}`, { url: value });
    setUrl('');
  };

  const urlKeys = Object.keys(outcomes).filter((k) => k.startsWith('url:'));
  const status = (key: string) => {
    const o = outcomes[key];
    return o ? <Status outcome={o} state={o.kind === 'accepted' ? jobs[o.jobId]?.state : undefined} /> : null;
  };

  return (
    <section className={styles.panel} aria-labelledby="ingest-title">
      <div className={styles.head}>
        <h2 id="ingest-title" className={styles.title}>
          Add to the shelf
        </h2>
        <p className={styles.sub}>
          {files === null
            ? 'Looking in library/…'
            : files.length === 0
              ? 'Every file in library/ is already on the shelf.'
              : `${files.length} ${files.length === 1 ? 'file is' : 'files are'} waiting in library/.`}
        </p>
      </div>

      {problem ? <Problem inline title="The library folder could not be listed." problem={problem} /> : null}

      {files && files.length > 0 ? (
        <ul className={styles.files}>
          {files.map((file) => (
            <li key={file.path} className={styles.file}>
              <span className={styles.kind} data-kind={file.kind}>
                {file.path.split('.').pop()}
              </span>
              <span className={styles.name}>
                <span className={styles.suggested}>{file.suggested_title}</span>
                <span className={styles.path}>
                  {file.path}, {formatSize(file.size)}
                </span>
              </span>
              {outcomes[file.path] ? (
                status(file.path)
              ) : (
                <button type="button" className={styles.add} onClick={() => void add(file.path, { path: file.path })}>
                  Add to shelf
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      <form className={styles.url} onSubmit={submitUrl}>
        <label htmlFor="ingest-url" className={styles.urlLabel}>
          Or add an article by URL
        </label>
        <div className={styles.urlRow}>
          <input
            id="ingest-url"
            type="url"
            required
            pattern="https?://.+"
            placeholder="https://example.com/essay"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="submit" className={styles.add}>
            Add article
          </button>
        </div>
      </form>

      {urlKeys.length > 0 ? (
        <ul className={styles.files}>
          {urlKeys.map((key) => (
            <li key={key} className={styles.file}>
              <span className={styles.kind} data-kind="article">
                url
              </span>
              <span className={styles.name}>
                <span className={styles.path}>{key.slice(4)}</span>
              </span>
              {status(key)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Status({ outcome, state }: { outcome: Pending; state: JobState | undefined }) {
  switch (outcome.kind) {
    case 'sending':
      return (
        <span className={styles.status} role="status">
          Adding…
        </span>
      );
    case 'duplicate':
      return (
        <span className={styles.status} role="status" data-tone="note">
          Already on the shelf.{' '}
          {outcome.slug ? <a href={`/documents/${outcome.slug}`}>Open it</a> : null}
        </span>
      );
    case 'failed':
      return <Problem inline title="Could not add it." problem={outcome.problem} />;
    case 'accepted': {
      const finished = isFinished(state);
      return (
        <span className={styles.status} role="status" data-tone={state === 'failed' ? 'bad' : finished ? 'good' : 'busy'}>
          {finished ? null : <span className={styles.spinner} aria-hidden="true" />}
          {jobPhrase(state)}.{' '}
          <a href={`/documents/${outcome.slug}`}>{state === 'done' ? 'Open' : 'Follow it'}</a>
        </span>
      );
    }
  }
}

export default IngestPanel;

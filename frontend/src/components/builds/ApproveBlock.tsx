/**
 * The last look before anything is created: where the repository goes, how commits read,
 * the limits. The repo name can still change here (the planner's suggestion fills a blank
 * one); a build into an existing repository (§7c) restates its target instead. Approving
 * starts the run (`POST /builds/{id}/approve`).
 */
import { useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildPublic } from '../../lib/api/types/builds';
import { approve } from '../../lib/builds/api';
import { LIMITS, validateRepoName } from '../../lib/builds/form';
import { stopsLine } from '../../lib/builds/state';
import { existingTarget, targetSummary } from '../../lib/builds/target-view';
import { problemOf } from '../common/Problem';
import { Field } from './Field';
import fields from './Fields.module.css';
import styles from './Plan.module.css';

const WHERE = { private: 'a private GitHub repository', public: 'a public GitHub repository', local: 'this computer only (no GitHub)' } as const;

export function ApproveBlock({ build, api, onChange }: { build: BuildPublic; api: Pick<ApiClient, 'post'>; onChange: (build: BuildPublic) => void }) {
  const { options, stops } = build;
  const [repoName, setRepoName] = useState(options.repo_name || build.plan?.repo_name || '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const into = targetSummary(options);
  const target = existingTarget(options);
  const nameProblem = into ? null : repoName.trim() ? validateRepoName(repoName) : 'Name the repository.';

  const start = async () => {
    if (nameProblem) return;
    setSending(true);
    setError(null);
    try {
      onChange(await approve(api, build.id, { options: into ? options : { ...options, repo_name: repoName.trim() }, stops }));
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setSending(false);
    }
  };

  const owner = options.owner ? `${options.owner}/` : '';
  return (
    <section className={styles.confirm} aria-labelledby="approve-title">
      <h3 id="approve-title" className={styles.subhead}>
        Ready to build?
      </h3>
      {into ? null : (
        <Field label="Repository name" error={nameProblem ?? undefined}>
          <input className={`${fields.input} ${fields.mono}`} maxLength={LIMITS.repoName.max} value={repoName} onChange={(e) => setRepoName(e.target.value)} />
        </Field>
      )}
      <ul className={styles.facts}>
        {into ? (
          <>
            <li>{into}.</li>
            <li>
              It writes only in <code>{target?.folder}</code>; a commit outside it {target?.confine === 'stop' ? 'stops the run' : 'is flagged'}.
            </li>
          </>
        ) : (
          <li>
            Goes to {WHERE[options.visibility]}
            {options.visibility !== 'local' ? (
              <>
                {' '}
                as <code>{`${owner}${repoName.trim() || '…'}`}</code>
              </>
            ) : null}
            .
          </li>
        )}
        <li>{options.claude_attribution ? 'Commits credit Claude as co-author.' : 'Commits carry no Claude credit.'}</li>
        <li>{options.link_paper ? 'The README names and links the paper.' : 'The README does not name the paper.'}</li>
        {options.allow_web ? <li>The agent may search and fetch from the web.</li> : null}
        {options.references?.length ? <li>It reads {options.references.length === 1 ? 'one reference' : `${options.references.length} references`} beside the paper.</li> : null}
        {!into && options.advanced?.delivery === 'pull_request' ? <li>It works on a branch and opens a pull request at the end.</li> : null}
        <li>Stops at {stopsLine(stops)}{stops.done_when.length ? `, or once ${stops.done_when.length} done-when line${stops.done_when.length === 1 ? '' : 's'} hold` : ''}.</li>
      </ul>
      {error ? (
        <p className={fields.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={fields.actions}>
        <button type="button" className="btn btn-primary" disabled={sending || nameProblem !== null} onClick={() => void start()}>
          {sending ? 'Starting…' : 'Approve & start building'}
        </button>
      </div>
    </section>
  );
}

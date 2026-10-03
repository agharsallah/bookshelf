/**
 * Preflight (`GET /builds/preflight`): what would stop a build now — `gh` not signed in,
 * an unapproved card — each with its fix. Checked on mount, again when the visibility
 * changes (a local build skips the GitHub checks), and on demand. Errors block; warnings
 * only inform. `onBlocked` tells the form whether to hold the submit button.
 */
import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildVisibility, Preflight, PreflightCheck } from '../../lib/api/types/builds';
import { preflight } from '../../lib/builds/api';
import { blocks, failingChecks, fixParts } from '../../lib/builds/plan';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { CopyCommand } from '../papers/CopyCommand';
import styles from './Form.module.css';

/** Failing checks, errors first, each with its fix; the commands in a fix are copyable. Shared with the repository inspection. */
export function CheckList({ checks }: { checks: readonly PreflightCheck[] }) {
  if (checks.length === 0) return null;
  return (
    <ul className={styles.checkList}>
      {checks.map((c) => {
        const fix = fixParts(c.fix);
        return (
          <li key={c.key} className={styles.check} data-level={c.level}>
            <p className={styles.checkMessage}>
              <strong>{c.level === 'error' ? 'Needed' : 'Worth knowing'}:</strong> {c.message}
            </p>
            {fix.text ? <p className={styles.checkFix}>{fix.text}</p> : null}
            {fix.commands.map((command) => (
              <div key={command}>
                <CopyCommand command={command} />
                <p className={styles.checkFix}>
                  Type <code>! {command}</code> in Claude Code, or run it in a terminal.
                </p>
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

export interface PreflightPanelProps {
  api: Pick<ApiClient, 'get'>;
  document: string;
  visibility: BuildVisibility;
  /** Bump to check again from outside (after a 409 on create). */
  recheck?: number;
  onBlocked: (blocked: boolean) => void;
}

export function PreflightPanel({ api, document, visibility, recheck = 0, onBlocked }: PreflightPanelProps) {
  const [result, setResult] = useState<Preflight | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [checking, setChecking] = useState(true);

  const check = useCallback(() => {
    setChecking(true);
    return preflight(api, document, visibility).then(
      (next) => {
        setResult(next);
        setProblem(null);
        onBlocked(!next.ready || blocks(next.checks));
      },
      (error: unknown) => {
        // The server checks again on create; a failed check here does not hold the form.
        setResult(null);
        setProblem(problemOf(error));
        onBlocked(false);
      },
    ).finally(() => setChecking(false));
  }, [api, document, visibility, onBlocked]);

  useEffect(() => {
    void check();
  }, [check, recheck]);

  const failing = result ? failingChecks(result.checks) : [];

  return (
    <section className={styles.preflight} aria-labelledby="preflight-title" aria-busy={checking}>
      <div className={styles.preflightHead}>
        <h3 id="preflight-title" className={styles.preflightTitle}>
          Before it starts
        </h3>
        <button type="button" className="btn btn-quiet" onClick={() => void check()} disabled={checking}>
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </div>
      {problem ? <Problem inline title="The setup could not be checked." problem={problem} /> : null}
      {result && failing.length === 0 ? <p className={styles.allSet}>All set: nothing stands in the way.</p> : null}
      <CheckList checks={failing} />
    </section>
  );
}

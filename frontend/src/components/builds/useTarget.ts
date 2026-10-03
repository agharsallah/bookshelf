/**
 * The inspection behind the form's **Where** (docs/BUILDS.md §7c): once a GitHub
 * repository is picked, or a local path checked, `POST /builds/target/inspect` runs, and
 * again (debounced) whenever the base, the folder or the branch changes. Only an
 * inspection of the form as it stands counts; until there is one, the submit waits.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { TargetInspection } from '../../lib/api/types/builds';
import { inspectTarget } from '../../lib/builds/api';
import { targetHold, targetOut, validateLocalPath, validateTarget, type TargetDraft } from '../../lib/builds/target';
import { problemOf, type ProblemInfo } from '../common/Problem';

/** How long typing in the folder or branch waits before inspecting again. */
export const INSPECT_DELAY_MS = 400;

export interface TargetState {
  /** The inspection of the target as it stands; null while none is current. */
  inspection: TargetInspection | null;
  inspecting: boolean;
  /** The inspection request failed. */
  problem: ProblemInfo | null;
  /** local: the path the last Check was for (a different path typed since needs another). */
  checkedPath: string;
  /** A repository is picked (github) or the path as typed was checked (local). */
  chosen: boolean;
  /** local: check the path as typed. */
  check: () => void;
  /** Ask again (after a failure). */
  retry: () => void;
  /** Why the submit waits on the target, or null. */
  hold: string | null;
}

export function useTarget(api: Pick<ApiClient, 'post'>, target: TargetDraft, delayMs = INSPECT_DELAY_MS): TargetState {
  const [checkedPath, setCheckedPath] = useState('');
  const [result, setResult] = useState<{ key: string; inspection: TargetInspection } | null>(null);
  const [failure, setFailure] = useState<{ key: string; info: ProblemInfo } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lastSubject = useRef('');

  const chosen = target.kind === 'github' ? target.repo.trim() !== '' : target.kind === 'local' && checkedPath !== '' && checkedPath === target.path.trim();
  const valid = Object.keys(validateTarget(target)).length === 0;
  const body = chosen && valid ? targetOut(target) : undefined;
  // What the inspection depends on: the switches (confine, instructions, push) do not count.
  const key = body ? JSON.stringify([body.kind, body.repo, body.path, body.base_branch, body.folder, body.branch]) : '';

  const sent = useRef(body);
  sent.current = body;

  useEffect(() => {
    const request = sent.current;
    if (!key || !request) return;
    const subject = `${request.kind}:${request.repo ?? request.path ?? ''}`;
    // A repository just picked is inspected at once; edits to it wait for typing to pause.
    const wait = lastSubject.current === subject ? delayMs : 0;
    lastSubject.current = subject;
    let live = true;
    const timer = setTimeout(() => {
      inspectTarget(api, sent.current ?? request).then(
        (inspection) => live && setResult({ key, inspection }),
        (error: unknown) => live && setFailure({ key, info: problemOf(error) }),
      );
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, key, delayMs, attempt]);

  const check = useCallback(() => {
    const path = target.path.trim();
    if (validateLocalPath(path)) return;
    setCheckedPath(path);
    setAttempt((n) => n + 1);
  }, [target.path]);

  const retry = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);

  const inspection = result && key && result.key === key ? result.inspection : null;
  const problem = failure && key && failure.key === key ? failure.info : null;
  const inspecting = Boolean(key) && !inspection && !problem;
  const hold =
    chosen && !valid ? 'Fix the repository fields above first.'
    : problem ? 'The repository could not be checked.'
    : inspecting ? 'Checking the repository…'
    : targetHold(target.kind, inspection, target.folder);
  return { inspection, inspecting, problem, checkedPath, chosen, check, retry, hold };
}

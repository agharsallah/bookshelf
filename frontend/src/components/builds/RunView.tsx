/**
 * A build past its plan: running, stopping, or finished. Its state, the repository, how
 * far it is against each limit, its commits, what the agent is doing, and at the end its
 * report. Stop while it runs; Continue or Delete once it has finished. Polls while active.
 * A Context tab beside the run shows what the agent received; a PR link once one is open.
 * A build whose plan was replanned or edited keeps a read-only Plan history (§7b). A build
 * into an existing repository (§7c) names its repo and folder; a local one, once ended,
 * says which branch of your repository holds the work.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { BuildPublic } from '../../lib/api/types/builds';
import { remove, stop } from '../../lib/builds/api';
import { canContinue, canDelete, isActive, repoLabel, STOP_REASON_LABELS } from '../../lib/builds/state';
import { localBranchNote, targetLabel } from '../../lib/builds/target-view';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { WithContext } from './BuildContextTab';
import { ConfirmButton } from './ConfirmButton';
import { ContinueForm } from './ContinueForm';
import { StateBadge } from './Field';
import fields from './Fields.module.css';
import { PlanHistoryDisclosure } from './PlanVersions';
import { ReplanForm } from './ReplanForm';
import { BranchNote, CommitList, EventTail, LimitMeters, RunReport } from './RunParts';
import styles from './Run.module.css';
import target from './Target.module.css';
import { POLL_MS, usePolledBuild } from './usePolledBuild';

export interface RunViewProps {
  build: BuildPublic;
  onChange: (build: BuildPublic) => void;
  onDeleted: (id: string) => void;
  api?: Pick<ApiClient, 'get' | 'post' | 'delete'>;
  pollMs?: number;
}

function stateLine(build: BuildPublic): string {
  if (build.state === 'building') return 'The agent is at work. This page follows along.';
  if (build.state === 'stopping') return 'Stopping: what is committed gets pushed, then it ends.';
  if (build.state === 'planning') return 'Drafting the plan…';
  if (build.stop_reason) return `It ended because ${STOP_REASON_LABELS[build.stop_reason]}.`;
  return build.state === 'failed' ? 'It failed.' : '';
}

export function RunView({ build, onChange, onDeleted, api = browserApi, pollMs = POLL_MS }: RunViewProps) {
  usePolledBuild(api, build, onChange, pollMs);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ title: string; info: ProblemInfo } | null>(null);

  const act = async (title: string, work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (error) {
      setProblem({ title, info: problemOf(error) });
    } finally {
      setBusy(false);
    }
  };

  const neverRan = build.state === 'failed' && !build.run_job_id;
  const where = targetLabel(build.options);
  const branchNote = neverRan ? null : localBranchNote(build);

  return (
    <div className={styles.run}>
      <div className={styles.head}>
        <StateBadge state={build.state} />
        <p className={styles.stateLine} role="status" aria-live="polite">
          {stateLine(build)}
        </p>
        {build.repo_url ? (
          <a className={styles.repo} href={build.repo_url} target="_blank" rel="noreferrer">
            {where ?? repoLabel(build.repo_url)} ↗
          </a>
        ) : where ? (
          <span className={target.where}>{where}</span>
        ) : build.state !== 'planning' && build.options.visibility === 'local' ? (
          <span className={fields.hint}>Kept on this computer</span>
        ) : null}
        {build.pr_url ? (
          <a className={styles.pr} href={build.pr_url} target="_blank" rel="noreferrer">
            Pull request ↗
          </a>
        ) : null}
      </div>

      <WithContext label="Run" build={build} api={api}>
        <div className={styles.body}>
          {build.error ? (
            <div className={styles.errorPanel} role="alert">
              <p className={styles.errorTitle}>What went wrong</p>
              <pre className={styles.errorText}>{build.error}</pre>
            </div>
          ) : null}

          {!neverRan ? <LimitMeters build={build} /> : null}

          {build.report ? <RunReport report={build.report} /> : null}

          {branchNote ? <BranchNote note={branchNote} /> : null}

          {!neverRan ? (
            <section aria-labelledby="commits-title">
              <h4 id="commits-title" className={styles.subhead}>
                Commits
              </h4>
              <CommitList commits={build.commits} repoUrl={build.repo_url} />
            </section>
          ) : null}

          <PlanHistoryDisclosure build={build} api={api} />

          <EventTail events={build.events} />

          {problem ? <Problem inline title={problem.title} problem={problem.info} /> : null}

          {neverRan ? <ReplanForm build={build} api={api} onChange={onChange} label="Plan again" /> : null}
          {canContinue(build.state) ? <ContinueForm build={build} api={api} onChange={onChange} /> : null}

          <div className={fields.actions} data-demo-off>
            {build.state === 'building' ? (
              <ConfirmButton
                label="Stop the build"
                question="Stop now? What is committed is kept and pushed."
                confirmLabel="Stop it"
                busy={busy}
                onConfirm={() => void act('The build was not stopped.', async () => onChange(await stop(api, build.id)))}
              />
            ) : null}
            {canDelete(build.state) && !isActive(build.state) ? (
              <ConfirmButton
                label="Delete this build"
                question="Delete it from the shelf? The GitHub repository stays."
                confirmLabel="Delete"
                busy={busy}
                onConfirm={() =>
                  void act('The build was not deleted.', async () => {
                    await remove(api, build.id);
                    onDeleted(build.id);
                  })
                }
              />
            ) : null}
          </div>
        </div>
      </WithContext>
    </div>
  );
}

/**
 * A plan being drafted (state `planning`): say so, and follow the build until the plan is
 * ready (or fails). After a replan the previous plan stays in view, dimmed, under a note
 * that names the version on its way (`Drafting v3…`), so you can still read what you asked
 * to change.
 */
import type { ApiClient } from '../../lib/api/client';
import type { BuildPublic } from '../../lib/api/types/builds';
import { StateBadge } from './Field';
import fields from './Fields.module.css';
import { PlanView } from './PlanView';
import studio from './Studio.module.css';
import styles from './Versions.module.css';
import { POLL_MS, usePolledBuild } from './usePolledBuild';

export interface PlanDraftingProps {
  build: BuildPublic;
  api: Pick<ApiClient, 'get'>;
  onChange: (build: BuildPublic) => void;
  pollMs?: number;
}

export function PlanDrafting({ build, api, onChange, pollMs = POLL_MS }: PlanDraftingProps) {
  usePolledBuild(api, build, onChange, pollMs);
  const previous = build.plan;
  const next = build.plan_versions_count + 1;
  return (
    <div className={styles.drafting}>
      <div className={studio.planning}>
        <StateBadge state={build.state} />
        <p role="status" aria-live="polite">
          {previous
            ? `Drafting v${next} with your feedback. It takes a minute or two; this page follows along.`
            : 'Drafting the plan from the paper and your goal. It takes a minute or two; this page follows along.'}
        </p>
      </div>
      {previous ? (
        <section aria-label={`The previous plan${build.plan_version ? `, v${build.plan_version}` : ''}`} aria-busy="true">
          <p className={fields.hint}>
            The plan you asked to change{build.plan_version ? ` (v${build.plan_version})` : ''}
            {build.plan_feedback ? `, with: “${build.plan_feedback}”` : ''}. It stays in the history once v{next} arrives.
          </p>
          <div className={styles.dimmed}>
            <PlanView plan={previous} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

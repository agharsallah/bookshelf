/**
 * A plan to review (state `planned`): read it, edit its milestones (`PUT /builds/{id}/plan`),
 * ask for another with your feedback (`POST …/replan`), or approve it and start the run.
 * Above it, once there is more than one, the plan's versions (§7b): an older one can be
 * read, compared and made current again; while you look at one, Edit, Replan and Approve
 * step aside. A Context tab beside it shows what the planner read.
 */
import { useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { BuildMilestone, BuildPublic } from '../../lib/api/types/builds';
import { putPlan } from '../../lib/builds/api';
import { withMilestones } from '../../lib/builds/plan';
import { problemOf } from '../common/Problem';
import { ApproveBlock } from './ApproveBlock';
import { WithContext } from './BuildContextTab';
import fields from './Fields.module.css';
import { MilestonesEditor } from './MilestonesEditor';
import styles from './Plan.module.css';
import { PlanHistory } from './PlanVersions';
import { PlanView } from './PlanView';
import { ReplanForm } from './ReplanForm';

export interface PlanReviewProps {
  build: BuildPublic;
  onChange: (build: BuildPublic) => void;
  api?: Pick<ApiClient, 'get' | 'post' | 'put'>;
}

export function PlanReview({ build, onChange, api = browserApi }: PlanReviewProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const plan = build.plan;
  if (!plan) return <p className={fields.status}>The plan is missing; ask for another below.</p>;

  const save = async (milestones: BuildMilestone[]) => {
    setSaving(true);
    setStatus('');
    try {
      onChange(await putPlan(api, build.id, withMilestones(plan, milestones)));
      setEditing(false);
      setStatus('Plan saved.');
    } catch (error) {
      setStatus(`Not saved: ${problemOf(error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const restored = (next: BuildPublic) => {
    setStatus(next.plan_version ? `v${next.plan_version} is the plan again.` : 'Plan restored.');
    onChange(next);
  };

  const version = build.plan_versions_count > 1 && build.plan_version ? ` (v${build.plan_version})` : '';

  return (
    <WithContext label="Plan" build={build} api={api}>
      <div className={styles.review}>
        <PlanHistory build={build} api={api} onRestored={restored} locked={editing}>
          <div className={styles.reviewHead}>
            <h3 className={fields.panelTitle}>
              The plan{version}
              {build.plan_origin === 'human' ? ', as you edited it' : ''}
            </h3>
            {!editing ? (
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                Edit milestones
              </button>
            ) : null}
          </div>
          {editing ? <MilestonesEditor initial={plan.milestones} saving={saving} onSave={(m) => void save(m)} onCancel={() => setEditing(false)} /> : <PlanView plan={plan} />}
          <p className={fields.status} role="status">
            {status}
          </p>
          <details className={styles.replan}>
            <summary>Replan with feedback</summary>
            <ReplanForm build={build} api={api} onChange={onChange} />
          </details>
          {!editing ? <ApproveBlock build={build} api={api} onChange={onChange} /> : null}
        </PlanHistory>
      </div>
    </WithContext>
  );
}

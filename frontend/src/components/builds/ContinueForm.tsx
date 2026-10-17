/**
 * Continue a finished or stopped build (`POST /builds/{id}/continue`): the same repository
 * and agent session, an optional extra goal and fresh limits for the next stretch.
 */
import { useState, type FormEvent } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildPublic } from '../../lib/api/types/builds';
import { continueBuild } from '../../lib/builds/api';
import { stopsOf, validateExtraGoal, validateStops, type DraftErrors } from '../../lib/builds/form';
import { problemOf } from '../common/Problem';
import { Field } from './Field';
import fields from './Fields.module.css';
import { LimitsFields, type Limits } from './LimitsFields';

export function ContinueForm({ build, api, onChange }: { build: BuildPublic; api: Pick<ApiClient, 'post'>; onChange: (build: BuildPublic) => void }) {
  const [goal, setGoal] = useState('');
  const [limits, setLimits] = useState<Limits>({
    maxMinutes: build.stops.max_minutes,
    maxCommits: build.stops.max_commits,
    maxBudget: build.stops.max_budget_usd,
  });
  const [errors, setErrors] = useState<DraftErrors>({});
  const [goalError, setGoalError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const draft = { ...limits, doneWhen: build.stops.done_when };
    const found = validateStops(draft);
    const goalProblem = validateExtraGoal(goal);
    setErrors(found);
    setGoalError(goalProblem);
    if (Object.keys(found).length > 0 || goalProblem) return;
    setSending(true);
    setError(null);
    try {
      const extra = goal.trim();
      onChange(await continueBuild(api, build.id, { ...(extra ? { goal: extra } : {}), stops: stopsOf(draft) }));
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={fields.fieldset} onSubmit={(event) => void submit(event)} noValidate aria-labelledby="continue-title">
      <h4 id="continue-title" className={fields.legend}>
        Keep going
      </h4>
      <Field label="What next (optional)" hint="Left empty, the agent picks up the plan where it stopped." error={goalError ?? undefined}>
        <textarea className={fields.textarea} value={goal} onChange={(e) => setGoal(e.target.value)} />
      </Field>
      <LimitsFields value={limits} errors={errors} onChange={setLimits} />
      {error ? (
        <p className={fields.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={fields.actions}>
        <button type="submit" className="btn btn-primary" data-demo-off disabled={sending}>
          {sending ? 'Starting…' : 'Continue the build'}
        </button>
      </div>
    </form>
  );
}

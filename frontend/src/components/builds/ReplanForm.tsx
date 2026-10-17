/** "Replan with this feedback" (`POST /builds/{id}/replan`): for a plan you want changed, or a failed one. */
import { useState, type FormEvent } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildPublic } from '../../lib/api/types/builds';
import { replan } from '../../lib/builds/api';
import { problemOf } from '../common/Problem';
import { Field } from './Field';
import fields from './Fields.module.css';

export interface ReplanFormProps {
  build: BuildPublic;
  api: Pick<ApiClient, 'post'>;
  onChange: (build: BuildPublic) => void;
  label?: string;
}

export function ReplanForm({ build, api, onChange, label = 'Replan with this feedback' }: ReplanFormProps) {
  const [feedback, setFeedback] = useState(build.plan_feedback ?? '');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      onChange(await replan(api, build.id, feedback.trim()));
    } catch (problem) {
      setError(problemOf(problem).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={fields.fieldset} onSubmit={(event) => void submit(event)}>
      <Field label="Feedback for the planner" hint="What to change: fewer milestones, another library, a different first step…" error={error ?? undefined}>
        <textarea className={fields.textarea} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
      </Field>
      <div className={fields.actions}>
        <button type="submit" className="btn" data-demo-off disabled={sending || !feedback.trim()}>
          {sending ? 'Sending…' : label}
        </button>
      </div>
    </form>
  );
}

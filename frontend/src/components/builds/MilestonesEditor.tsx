/**
 * The plan's milestones as fields: title, commit message, deliverable and done-when each,
 * with add, remove and move up / down. Saving sends the whole plan (`PUT /builds/{id}/plan`).
 */
import { useState } from 'react';
import type { BuildMilestone } from '../../lib/api/types/builds';
import { blankMilestone, MILESTONE_MAX, MILESTONES, milestonesProblem, move, removeAt } from '../../lib/builds/plan';
import { Field } from './Field';
import fields from './Fields.module.css';
import styles from './Plan.module.css';

export interface MilestonesEditorProps {
  initial: readonly BuildMilestone[];
  saving: boolean;
  onSave: (milestones: BuildMilestone[]) => void;
  onCancel: () => void;
}

export function MilestonesEditor({ initial, saving, onSave, onCancel }: MilestonesEditorProps) {
  const [items, setItems] = useState<BuildMilestone[]>(() => initial.map((m) => ({ ...m })));
  const [problem, setProblem] = useState<string | null>(null);
  const edit = (i: number, patch: Partial<BuildMilestone>) => setItems(items.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  const save = () => {
    const found = milestonesProblem(items);
    setProblem(found);
    if (!found) onSave(items);
  };

  return (
    <div className={styles.editor}>
      <ol className={styles.editList}>
        {items.map((m, i) => (
          <li key={i} className={styles.editItem}>
            <fieldset className={fields.fieldset}>
              <legend className={fields.legend}>Milestone {i + 1}</legend>
              <Field label="Title">
                <input className={fields.input} maxLength={MILESTONE_MAX.title} value={m.title} onChange={(e) => edit(i, { title: e.target.value })} />
              </Field>
              <Field label="Commit message">
                <input className={`${fields.input} ${fields.mono}`} maxLength={MILESTONE_MAX.commit} value={m.commit} onChange={(e) => edit(i, { commit: e.target.value })} />
              </Field>
              <Field label="Deliverable">
                <textarea className={fields.textarea} maxLength={MILESTONE_MAX.deliverable} value={m.deliverable} onChange={(e) => edit(i, { deliverable: e.target.value })} />
              </Field>
              <Field label="Done when">
                <input className={fields.input} maxLength={MILESTONE_MAX.done_when} value={m.done_when} onChange={(e) => edit(i, { done_when: e.target.value })} />
              </Field>
              <div className={fields.actions}>
                <button type="button" className="btn btn-quiet" disabled={i === 0} onClick={() => setItems(move(items, i, -1))} aria-label={`Move milestone ${i + 1} up`}>
                  ↑ Up
                </button>
                <button
                  type="button"
                  className="btn btn-quiet"
                  disabled={i === items.length - 1}
                  onClick={() => setItems(move(items, i, 1))}
                  aria-label={`Move milestone ${i + 1} down`}
                >
                  ↓ Down
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setItems(removeAt(items, i))} aria-label={`Remove milestone ${i + 1}`}>
                  Remove
                </button>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {problem ? (
        <p className={fields.error} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={fields.actions}>
        <button type="button" className="btn" disabled={items.length >= MILESTONES.max} onClick={() => setItems([...items, blankMilestone()])}>
          + Add a milestone
        </button>
        <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save the plan'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

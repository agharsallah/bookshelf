/**
 * The form's repository options: **Where** first (a new repository, or a folder of one you
 * have), then what applies to it. A new repository gets a name and a visibility; an
 * existing one keeps its own. How commits read applies to both.
 */
import type { ApiClient } from '../../lib/api/client';
import { LIMITS, VISIBILITY_OPTIONS, type BuildDraft, type DraftErrors } from '../../lib/builds/form';
import { repoFieldsFor, type TargetDraft } from '../../lib/builds/target';
import { Check, Segmented } from '../settings/Controls';
import { Field } from './Field';
import fields from './Fields.module.css';
import styles from './Form.module.css';
import { TargetPicker } from './TargetPicker';
import type { TargetState } from './useTarget';

export interface RepositoryFieldsProps {
  api: Pick<ApiClient, 'get'>;
  draft: BuildDraft;
  errors: DraftErrors;
  target: TargetState;
  onChange: (patch: Partial<BuildDraft>) => void;
  searchDelayMs?: number;
}

export function RepositoryFields({ api, draft, errors, target, onChange, searchDelayMs }: RepositoryFieldsProps) {
  const shown = repoFieldsFor(draft.target.kind);
  const setTarget = (patch: Partial<TargetDraft>) => onChange({ target: { ...draft.target, ...patch } });
  return (
    <fieldset className={fields.fieldset}>
      <legend className={fields.legend}>Repository</legend>
      <TargetPicker api={api} value={draft.target} onChange={setTarget} state={target} errors={errors} searchDelayMs={searchDelayMs} />
      {shown.name ? (
        <Field label="Name" hint="Leave it blank to let the planner suggest one." error={errors.repoName}>
          <input className={`${fields.input} ${fields.mono}`} maxLength={LIMITS.repoName.max} value={draft.repoName} onChange={(e) => onChange({ repoName: e.target.value })} />
        </Field>
      ) : null}
      {shown.visibility ? (
        <div className={styles.segmentRow}>
          <span className={fields.label}>Visibility</span>
          <Segmented label="Visibility" value={draft.visibility} options={VISIBILITY_OPTIONS} onChange={(visibility) => onChange({ visibility })} />
        </div>
      ) : null}
      <div className={styles.checks}>
        <Check
          label="Credit Claude in commits"
          hint="A Co-Authored-By trailer on each commit."
          checked={draft.claudeAttribution}
          onChange={(claudeAttribution) => onChange({ claudeAttribution })}
        />
        <Check label="Name the paper in the README" checked={draft.linkPaper} onChange={(linkPaper) => onChange({ linkPaper })} />
      </div>
    </fieldset>
  );
}

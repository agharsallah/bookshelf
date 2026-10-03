/**
 * **Where** a build lands (docs/BUILDS.md §7c), at the top of the repository options: a
 * new repository, a folder of one of your GitHub repositories (searchable), or a folder
 * of a repository on this machine (a path, then Check). Once one is chosen: the base
 * branch (from the inspection), the folder with a live free / empty / taken hint, the
 * branch, how the work is delivered, a few rules, and what the inspection found.
 */
import type { ApiClient } from '../../lib/api/client';
import {
  CONFINE_OPTIONS,
  deliveryChoices,
  folderHint,
  folderState,
  KIND_CARDS,
  normalizeFolder,
  suggestBranch,
  validateBranch,
  validateFolder,
  validateLocalPath,
  type TargetDraft,
  type TargetErrors,
} from '../../lib/builds/target';
import { Segmented } from '../settings/Controls';
import context from './Context.module.css';
import { onEnter, Switch } from './Disclosure';
import { Field } from './Field';
import fields from './Fields.module.css';
import form from './Form.module.css';
import { InspectionCard } from './InspectionCard';
import { RepoCombobox } from './RepoCombobox';
import styles from './Target.module.css';
import type { TargetState } from './useTarget';

export interface TargetPickerProps {
  api: Pick<ApiClient, 'get'>;
  value: TargetDraft;
  onChange: (patch: Partial<TargetDraft>) => void;
  state: TargetState;
  /** From the last submit; the folder and branches are also checked as you type. */
  errors: TargetErrors;
  searchDelayMs?: number;
}

function LocalPath({ value, onChange, state, error }: Pick<TargetPickerProps, 'value' | 'onChange' | 'state'> & { error: string | undefined }) {
  const typed = value.path.trim();
  const stale = state.checkedPath !== '' && state.checkedPath !== typed;
  const hint = state.chosen ? `Checked ${typed}.` : stale ? 'The path changed: check it again.' : 'The repository stays as it is: the build works in a git worktree of it, on a branch of its own.';
  return (
    <div className={styles.pathRow} onKeyDown={onEnter(state.check)}>
      <Field label="Path" hint={hint} error={error}>
        <input className={`${fields.input} ${fields.mono}`} placeholder="/Users/you/code/project" spellCheck={false} value={value.path} onChange={(e) => onChange({ path: e.target.value })} />
      </Field>
      <button type="button" className="btn" disabled={!typed || (state.chosen && !state.problem)} onClick={state.check}>
        {state.chosen && state.inspecting ? 'Checking…' : 'Check'}
      </button>
    </div>
  );
}

function Delivery({ value, onChange, base, branch }: Pick<TargetPickerProps, 'value' | 'onChange'> & { base: string; branch: string }) {
  if (value.kind === 'local') {
    return (
      <div className={context.setting}>
        <span className={fields.label}>Delivery</span>
        <p className={fields.hint}>
          The work stays on <code>{branch}</code> in your repository; nothing of yours is checked out or changed.
        </p>
        <Switch label={`Also push ${branch} to origin`} checked={value.pushBranch} onChange={(pushBranch) => onChange({ pushBranch })} />
      </div>
    );
  }
  const choices = deliveryChoices(base);
  const chosen = choices.find((c) => c.value === value.delivery) ?? choices[0];
  return (
    <div className={context.setting}>
      <span className={fields.label}>Delivery</span>
      <Segmented label="Delivery" value={value.delivery} options={choices} onChange={(delivery) => onChange({ delivery })} />
      <p className={chosen?.warn ? styles.warn : fields.hint}>{chosen?.hint}</p>
    </div>
  );
}

export function TargetPicker({ api, value, onChange, state, errors, searchDelayMs }: TargetPickerProps) {
  const { inspection } = state;
  const base = value.baseBranch || inspection?.default_branch || '';
  const branches = inspection ? [...new Set([...(inspection.default_branch ? [inspection.default_branch] : []), ...inspection.branches])] : base ? [base] : [];
  const folderError = validateFolder(value.folder) ?? (inspection && folderState(inspection) === 'taken' ? folderHint(value.folder, 'taken') : undefined) ?? errors.targetFolder;
  const folderNote = inspection && !folderError ? folderHint(value.folder, folderState(inspection)) : state.inspecting ? `Checking ${normalizeFolder(value.folder) || 'the folder'}…` : 'A folder of its own: the agent writes nowhere else.';
  const branch = value.branch.trim() || suggestBranch(value.folder);
  const pathError = value.kind === 'local' ? (errors.targetPath ?? (value.path.trim() ? (validateLocalPath(value.path) ?? undefined) : undefined)) : undefined;

  return (
    <div className={styles.target}>
      <fieldset className={fields.fieldset}>
        <legend className={fields.legend}>Where</legend>
        <div className={form.presets}>
          {KIND_CARDS.map((card) => (
            <label key={card.value} className={form.preset}>
              <input type="radio" name="build-target" value={card.value} checked={value.kind === card.value} onChange={() => onChange({ kind: card.value })} />
              <span className={form.presetLabel}>{card.label}</span>
              <span className={form.presetHint}>{card.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {value.kind === 'github' ? (
        <RepoCombobox api={api} value={value.repo} error={errors.targetRepo} delayMs={searchDelayMs} onPick={(repo) => onChange({ repo: repo.full_name, baseBranch: '' })} />
      ) : null}
      {value.kind === 'local' ? <LocalPath value={value} onChange={onChange} state={state} error={pathError} /> : null}

      {value.kind !== 'new' && state.chosen ? (
        <>
          <div className={fields.row}>
            <Field label="Base branch" hint="The branch the build starts from.">
              <select className={fields.input} value={base} disabled={!inspection} onChange={(e) => onChange({ baseBranch: e.target.value === inspection?.default_branch ? '' : e.target.value })}>
                {branches.length === 0 ? <option value="">Default branch</option> : null}
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                    {b === inspection?.default_branch ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Folder" hint={folderError ? undefined : folderNote} error={folderError ?? undefined}>
              <input className={`${fields.input} ${fields.mono}`} spellCheck={false} value={value.folder} onChange={(e) => onChange({ folder: e.target.value })} />
            </Field>
          </div>
          <Field label="Branch" hint={`Blank: ${suggestBranch(value.folder)}, made from ${base || 'the base'}.`} error={validateBranch(value.branch) ?? errors.targetBranch}>
            <input className={`${fields.input} ${fields.mono}`} spellCheck={false} placeholder={suggestBranch(value.folder)} value={value.branch} onChange={(e) => onChange({ branch: e.target.value })} />
          </Field>
          <Delivery value={value} onChange={onChange} base={base || 'the default branch'} branch={branch} />

          <fieldset className={context.group}>
            <legend className={fields.legend}>Rules</legend>
            <div className={context.setting}>
              <span className={fields.label}>Outside the folder</span>
              <Segmented label="Outside the folder" value={value.confine} options={CONFINE_OPTIONS} onChange={(confine) => onChange({ confine })} />
              <p className={fields.hint}>
                The agent may read the whole repository but writes only in <code>{normalizeFolder(value.folder) || 'its folder'}</code>. If a commit touches anything else: {value.confine === 'stop' ? 'the run stops.' : 'it is flagged in the run.'}
              </p>
            </div>
            <Switch label="Follow the repository’s CLAUDE.md / AGENTS.md" checked={value.useRepoInstructions} onChange={(useRepoInstructions) => onChange({ useRepoInstructions })} />
          </fieldset>

          <InspectionCard
            where={value.kind === 'github' ? value.repo : value.path.trim()}
            inspection={inspection}
            inspecting={state.inspecting}
            problem={state.problem}
            onRetry={state.retry}
            folder={value.folder}
            useInstructions={value.useRepoInstructions}
          />
        </>
      ) : null}
    </div>
  );
}

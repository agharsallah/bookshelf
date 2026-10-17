/**
 * A new build: pick a preset (or say it yourself), the goal, what done looks like, the
 * limits and where it goes: a new repository, or a folder of one you have (§7c). Preflight
 * runs alongside and holds the submit button while a required check fails; so does an
 * existing repository until its inspection is clean. Submitting queues the plan
 * (`POST /papers/{ref}/builds`).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, browserApi, type ApiClient } from '../../lib/api/client';
import type { BuildDefaults, BuildPreset, BuildPublic } from '../../lib/api/types/builds';
import type { SettingsPublic } from '../../lib/api/types/settings';
import { advancedBaseline } from '../../lib/builds/advanced';
import { createBuild, listPresets } from '../../lib/builds/api';
import { applyPreset, createBody, FALLBACK_DEFAULTS, GOAL_EXAMPLES, initialDraft, LIMITS, optionsOf, suggestRepoName, validateDraft, type BuildDraft, type DraftErrors } from '../../lib/builds/form';
import { defaultTarget, repoFieldsFor, visibilityFor } from '../../lib/builds/target';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { AdvancedPanel } from './AdvancedPanel';
import { ContextPanel } from './ContextPanel';
import { Field } from './Field';
import fields from './Fields.module.css';
import styles from './Form.module.css';
import { DoneWhenEditor, LimitsFields } from './LimitsFields';
import { PreflightPanel } from './PreflightPanel';
import { PresetPicker } from './PresetPicker';
import { RepositoryFields } from './RepositoryFields';
import { useTarget } from './useTarget';

/** What the target hook watches before the form is ready. */
const NO_TARGET = defaultTarget('');

export interface BuildFormProps {
  /** The paper's id or slug (preflight and the create route take either). */
  paperRef: string;
  paperTitle: string;
  onCreated: (build: BuildPublic) => void;
  onCancel?: () => void;
  api?: Pick<ApiClient, 'get' | 'post'>;
  /** Debounces for the repository inspection and search (tests pass 0). */
  inspectDelayMs?: number;
  searchDelayMs?: number;
}

export function BuildForm({ paperRef, paperTitle, onCreated, onCancel, api = browserApi, inspectDelayMs, searchDelayMs }: BuildFormProps) {
  const [defaults, setDefaults] = useState<BuildDefaults | null>(null);
  const [presets, setPresets] = useState<BuildPreset[]>([]);
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [blocked, setBlocked] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const target = useTarget(api, draft?.target ?? NO_TARGET, inspectDelayMs);

  useEffect(() => {
    let live = true;
    const settings = api.get<SettingsPublic>('settings').then(
      (s) => s.builds ?? FALLBACK_DEFAULTS,
      () => FALLBACK_DEFAULTS,
    );
    const presetList = listPresets(api).catch(() => [] as BuildPreset[]);
    void Promise.all([settings, presetList]).then(([d, p]) => {
      if (!live) return;
      setDefaults(d);
      setPresets(p);
      setDraft(initialDraft(d, suggestRepoName(paperTitle)));
    });
    return () => {
      live = false;
    };
  }, [api, paperTitle]);

  if (!draft || !defaults) return <p className={fields.status}>Getting the form ready…</p>;

  const set = (patch: Partial<BuildDraft>) => setDraft({ ...draft, ...patch });
  const visibility = visibilityFor(draft.target.kind, draft.visibility);
  const held = blocked || target.hold !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setSending(true);
    setProblem(null);
    try {
      onCreated(await createBuild(api, paperRef, createBody(draft)));
    } catch (error) {
      setProblem(problemOf(error));
      // A 409 carries failing checks: show them where they belong.
      if (error instanceof ApiError && error.status === 409) setRecheck((n) => n + 1);
    } finally {
      setSending(false);
    }
  };

  return (
    <form className={styles.form} data-demo-off onSubmit={(event) => void submit(event)} noValidate aria-labelledby="build-form-title">
      <h2 id="build-form-title" className={fields.panelTitle}>
        Build from this paper
      </h2>
      {presets.length > 0 ? <PresetPicker presets={presets} value={draft.preset} onPick={(p) => setDraft(applyPreset(draft, p, defaults))} /> : null}

      <Field label="Goal" hint="What should exist at the end, in a sentence or two." error={errors.goal}>
        <textarea
          className={fields.textarea}
          maxLength={LIMITS.goal.max}
          placeholder={GOAL_EXAMPLES[0]}
          value={draft.goal}
          onChange={(e) => set({ goal: e.target.value })}
        />
      </Field>
      <div className={styles.examples}>
        <span className={fields.hint}>For example:</span>
        <ul className={fields.chips}>
          {GOAL_EXAMPLES.map((example) => (
            <li key={example}>
              <button type="button" className={fields.chip} onClick={() => set({ goal: example })}>
                {example}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Field label="Stack" hint="Languages and libraries, if you have a preference.">
        <input className={fields.input} placeholder="PyTorch, Astro + D3…" value={draft.stack} onChange={(e) => set({ stack: e.target.value })} />
      </Field>

      <DoneWhenEditor lines={draft.doneWhen} error={errors.doneWhen} onChange={(doneWhen) => set({ doneWhen })} />

      <fieldset className={fields.fieldset}>
        <legend className={fields.legend}>Limits</legend>
        <p className={fields.hint}>The run stops at the first one reached, whatever the agent thinks.</p>
        <LimitsFields value={draft} errors={errors} onChange={set} />
      </fieldset>

      <RepositoryFields api={api} draft={draft} errors={errors} target={target} onChange={set} searchDelayMs={searchDelayMs} />

      <div className={styles.disclosures}>
        <ContextPanel
          api={api}
          paperRef={paperRef}
          value={draft}
          onChange={set}
          linkPaper={draft.linkPaper}
          allowWeb={draft.allowWeb}
          errors={errors}
          options={() => optionsOf(draft)}
          extraCommands={draft.advanced.extra_commands}
        />
        <AdvancedPanel
          advanced={draft.advanced}
          allowWeb={draft.allowWeb}
          visibility={visibility}
          repoFields={repoFieldsFor(draft.target.kind, draft.target.pushBranch)}
          baseline={advancedBaseline(defaults.advanced)}
          presetToolchains={presets.find((p) => p.key === draft.preset)?.toolchains ?? []}
          errors={errors}
          onChange={set}
        />
      </div>

      <PreflightPanel api={api} document={paperRef} visibility={visibility} recheck={recheck} onBlocked={setBlocked} />

      {problem ? <Problem inline title="The build was not started." problem={problem} /> : null}
      <div className={fields.actions}>
        <button type="submit" className="btn btn-primary" disabled={held || sending}>
          {sending ? 'Sending…' : 'Draft the plan'}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
        {held ? <span className={fields.hint}>{target.hold ?? 'Fix what is needed above first.'}</span> : null}
      </div>
    </form>
  );
}

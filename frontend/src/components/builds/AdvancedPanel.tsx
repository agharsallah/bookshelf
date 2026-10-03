/**
 * "Advanced" (docs/BUILDS.md §7): the knobs the defaults hide, grouped Model · Tools ·
 * Workflow · Repository, each with a line on what it changes. Closed, its summary counts
 * what differs from where a new build starts (your settings over the built-in defaults);
 * *Reset to defaults* puts it all back.
 */
import type { ReactNode } from 'react';
import { BUILD_TOOLCHAINS, type BuildAdvanced, type BuildToolchain, type BuildVisibility } from '../../lib/api/types/builds';
import {
  ADVANCED_LIMITS,
  changedCount,
  COMMIT_OPTIONS,
  DELIVERY_OPTIONS,
  effectiveDelivery,
  EFFORT_OPTIONS,
  LICENSE_OPTIONS,
  MODEL_OPTIONS,
  PUSH_OPTIONS,
  TESTS_OPTIONS,
  TOOLCHAIN_LABELS,
  validateExtraCommand,
  validateTopic,
  type AdvancedErrors,
} from '../../lib/builds/advanced';
import { Check, Segmented } from '../settings/Controls';
import styles from './Context.module.css';
import { ChipsInput, Counter, Disclosure } from './Disclosure';
import { Field } from './Field';
import fields from './Fields.module.css';

export interface AdvancedPanelProps {
  advanced: BuildAdvanced;
  allowWeb: boolean;
  visibility: BuildVisibility;
  /** Where a new build starts: the reset target and what "changed" counts against. */
  baseline: BuildAdvanced;
  /** The chosen preset's toolchains, what *Auto* means. */
  presetToolchains: readonly string[];
  errors: AdvancedErrors;
  onChange: (patch: { advanced?: BuildAdvanced; allowWeb?: boolean }) => void;
}

/** A labelled control with one line on its effect. */
function Setting({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className={styles.setting}>
      <span className={fields.label}>{label}</span>
      {children}
      <p className={fields.hint}>{hint}</p>
    </div>
  );
}

export function AdvancedPanel({ advanced, allowWeb, visibility, baseline, presetToolchains, errors, onChange }: AdvancedPanelProps) {
  const set = (patch: Partial<BuildAdvanced>) => onChange({ advanced: { ...advanced, ...patch } });
  const changed = changedCount(advanced, allowWeb, baseline);
  const local = visibility === 'local';
  const auto = presetToolchains.length ? presetToolchains.join(', ') : 'inferred from the stack';
  const toggleChain = (chain: BuildToolchain) => {
    const current = advanced.toolchains ?? BUILD_TOOLCHAINS.filter((c) => presetToolchains.includes(c));
    const next = current.includes(chain) ? current.filter((c) => c !== chain) : BUILD_TOOLCHAINS.filter((c) => c === chain || current.includes(c));
    set({ toolchains: next });
  };

  return (
    <Disclosure title="Advanced" meta="Model · Tools · Workflow · Repository" badge={changed ? `${changed} changed` : null} forceOpen={Boolean(errors.extraCommands ?? errors.instructions ?? errors.description ?? errors.topics)}>
      <div className={styles.advancedHead}>
        <p className={styles.lede}>For when you know what you want. Every default here is safe; your settings choose most of them.</p>
        <button type="button" className="btn btn-quiet" disabled={changed === 0} onClick={() => onChange({ advanced: baseline, allowWeb: false })}>
          Reset to defaults
        </button>
      </div>

      <fieldset className={styles.group}>
        <legend className={fields.legend}>Model</legend>
        <Setting label="Build model" hint="Auto uses the agent's own tier. Opus reasons best and costs most; Haiku is quick and cheap.">
          <Segmented label="Build model" value={advanced.model} options={MODEL_OPTIONS} onChange={(model) => set({ model })} />
        </Setting>
        <Setting label="Effort" hint="How long it thinks before each step: higher is slower and costs more.">
          <Segmented label="Effort" value={advanced.effort} options={EFFORT_OPTIONS} onChange={(effort) => set({ effort })} />
        </Setting>
        <Setting label="Plan model" hint="The model that drafts the plan you review.">
          <Segmented label="Plan model" value={advanced.plan_model} options={MODEL_OPTIONS} onChange={(plan_model) => set({ plan_model })} />
        </Setting>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={fields.legend}>Tools</legend>
        <Check
          label="Let the agent search the web"
          hint="Loosens the sandbox: the agent may fetch pages and search while it works. Off, snapshot your links instead."
          checked={allowWeb}
          onChange={(on) => onChange({ allowWeb: on })}
        />
        <Setting label="Toolchains" hint={`Which ecosystems' commands it may run (installs, tests, a dev server). Auto: ${auto}.`}>
          <ul className={fields.chips} aria-label="Toolchains">
            <li>
              <button type="button" className={`${fields.chip} ${styles.toggle}`} aria-pressed={advanced.toolchains === null} onClick={() => set({ toolchains: null })}>
                Auto
              </button>
            </li>
            {BUILD_TOOLCHAINS.map((chain) => (
              <li key={chain}>
                <button type="button" className={`${fields.chip} ${styles.toggle}`} aria-pressed={advanced.toolchains?.includes(chain) ?? false} onClick={() => toggleChain(chain)}>
                  {TOOLCHAIN_LABELS[chain]}
                </button>
              </li>
            ))}
          </ul>
        </Setting>
        <ChipsInput
          label="Extra commands"
          hint="Each becomes Bash(command:*): the agent may run it with any arguments. Dangerous ones are refused."
          placeholder="make"
          values={advanced.extra_commands}
          max={ADVANCED_LIMITS.extraCommands.count}
          validate={validateExtraCommand}
          error={errors.extraCommands}
          onChange={(extra_commands) => set({ extra_commands })}
        />
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={fields.legend}>Workflow</legend>
        <Setting label="Commits" hint="One per milestone reads like the plan; small and often shows every step.">
          <Segmented label="Commit style" value={advanced.commit_style} options={COMMIT_OPTIONS} onChange={(commit_style) => set({ commit_style })} />
        </Setting>
        <Setting label="Tests" hint="What it tests before moving on. None is fastest, and trusts the code most.">
          <Segmented label="Tests" value={advanced.tests} options={TESTS_OPTIONS} onChange={(tests) => set({ tests })} />
        </Setting>
        <Field label="Instructions" hint="Added to the end of the kickoff prompt, word for word." error={errors.instructions}>
          <textarea
            className={fields.textarea}
            placeholder="Use type hints everywhere. Keep every file under 200 lines…"
            value={advanced.instructions ?? ''}
            onChange={(e) => set({ instructions: e.target.value })}
          />
        </Field>
        <Counter length={(advanced.instructions ?? '').length} max={ADVANCED_LIMITS.instructions} />
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={fields.legend}>Repository</legend>
        <Setting label="License" hint="Adds a LICENSE file to the repository.">
          <Segmented label="License" value={advanced.license} options={LICENSE_OPTIONS} onChange={(license) => set({ license })} />
        </Setting>
        <Setting
          label="Delivery"
          hint={local ? 'A pull request needs GitHub: a local build commits on main.' : 'A pull request works on build/<repo> and opens the PR at the end, for you to review and merge.'}
        >
          <Segmented
            label="Delivery"
            value={effectiveDelivery(advanced.delivery, visibility)}
            options={DELIVERY_OPTIONS.map((o) => ({ ...o, disabled: local && o.value === 'pull_request' }))}
            onChange={(delivery) => set({ delivery })}
          />
        </Setting>
        <Setting label="Push" hint="Each commit: GitHub follows the run live. At the end: one push when it stops.">
          <Segmented label="Push" value={advanced.push} options={PUSH_OPTIONS} onChange={(push) => set({ push })} />
        </Setting>
        <Field label="Description" hint="The GitHub description. Blank: the plan's summary." error={errors.description}>
          <input className={fields.input} maxLength={ADVANCED_LIMITS.description} value={advanced.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <ChipsInput
          label="Topics"
          hint="GitHub topics, to find the repository again."
          placeholder="transformers"
          values={advanced.topics}
          max={ADVANCED_LIMITS.topics.count}
          validate={validateTopic}
          error={errors.topics}
          onChange={(topics) => set({ topics })}
        />
      </fieldset>
    </Disclosure>
  );
}

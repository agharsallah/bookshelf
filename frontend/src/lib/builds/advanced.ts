/**
 * Advanced build options (docs/BUILDS.md §7): their choices as the UI words them, the
 * defaults a new build starts from (the built-in ones under your settings), how many you
 * changed, and the same checks the backend makes.
 */
import {
  ADVANCED_DEFAULTS,
  type AdvancedDefaults,
  type BuildAdvanced,
  type BuildDelivery,
  type BuildEffort,
  type BuildLicense,
  type BuildModel,
  type BuildToolchain,
  type BuildVisibility,
  type CommitStyle,
  type PushCadence,
  type TestsPolicy,
} from '../api/types/builds';

export const ADVANCED_LIMITS = {
  extraCommands: { count: 10, pattern: /^[a-z0-9][a-z0-9 ._-]{0,40}$/ },
  instructions: 4000,
  description: 350,
  topics: { count: 10, pattern: /^[a-z0-9][a-z0-9-]{0,49}$/ },
} as const;

type Options<T extends string> = readonly { value: T; label: string }[];

export const MODEL_OPTIONS: Options<BuildModel> = [
  { value: 'auto', label: 'Auto' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

export const EFFORT_OPTIONS: Options<BuildEffort> = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-high' },
  { value: 'max', label: 'Max' },
];

export const COMMIT_OPTIONS: Options<CommitStyle> = [
  { value: 'milestone', label: 'One per milestone' },
  { value: 'small', label: 'Small and often' },
];

export const TESTS_OPTIONS: Options<TestsPolicy> = [
  { value: 'each_milestone', label: 'Each milestone' },
  { value: 'smoke', label: 'A smoke test' },
  { value: 'none', label: 'None' },
];

export const LICENSE_OPTIONS: Options<BuildLicense> = [
  { value: 'none', label: 'None' },
  { value: 'MIT', label: 'MIT' },
  { value: 'Apache-2.0', label: 'Apache 2.0' },
];

export const DELIVERY_OPTIONS: Options<BuildDelivery> = [
  { value: 'push_main', label: 'Push to main' },
  { value: 'pull_request', label: 'Pull request' },
];

export const PUSH_OPTIONS: Options<PushCadence> = [
  { value: 'each_commit', label: 'Each commit' },
  { value: 'at_end', label: 'At the end' },
];

export const TOOLCHAIN_LABELS: Record<BuildToolchain, string> = { python: 'Python', node: 'Node', static: 'Static site' };

/** Your settings' advanced defaults, the built-in ones filling any gap. */
export function advancedDefaultsOf(saved: Partial<AdvancedDefaults> | undefined): AdvancedDefaults {
  const d = ADVANCED_DEFAULTS;
  return {
    model: saved?.model ?? d.model,
    effort: saved?.effort ?? d.effort,
    plan_model: saved?.plan_model ?? d.plan_model,
    commit_style: saved?.commit_style ?? d.commit_style,
    tests: saved?.tests ?? d.tests,
    license: saved?.license ?? d.license,
    delivery: saved?.delivery ?? d.delivery,
    push: saved?.push ?? d.push,
  };
}

/** What a new build's advanced options start as: the built-in defaults under your settings. */
export const advancedBaseline = (saved: Partial<AdvancedDefaults> | undefined): BuildAdvanced => ({ ...ADVANCED_DEFAULTS, ...advancedDefaultsOf(saved) });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How many advanced values (allow web included) differ from where a new build starts. */
export function changedCount(advanced: BuildAdvanced, allowWeb: boolean, baseline: BuildAdvanced): number {
  const keys = Object.keys(ADVANCED_DEFAULTS) as (keyof BuildAdvanced)[];
  return keys.filter((k) => !same(advanced[k], baseline[k])).length + (allowWeb ? 1 : 0);
}

export function validateExtraCommand(command: string): string | null {
  return ADVANCED_LIMITS.extraCommands.pattern.test(command)
    ? null
    : 'A command name: lowercase letters, digits, spaces, dots, dashes, underscores (up to 41), starting with a letter or digit.';
}

export function validateTopic(topic: string): string | null {
  return ADVANCED_LIMITS.topics.pattern.test(topic) ? null : 'A GitHub topic: lowercase letters, digits and dashes (up to 50).';
}

export type AdvancedField = 'extraCommands' | 'instructions' | 'description' | 'topics';
export type AdvancedErrors = Partial<Record<AdvancedField, string>>;

export function validateAdvanced(advanced: BuildAdvanced): AdvancedErrors {
  const errors: AdvancedErrors = {};
  const commands = advanced.extra_commands;
  if (commands.length > ADVANCED_LIMITS.extraCommands.count) errors.extraCommands = `At most ${ADVANCED_LIMITS.extraCommands.count} commands.`;
  else {
    const bad = commands.map(validateExtraCommand).find(Boolean);
    if (bad) errors.extraCommands = bad;
  }
  if ((advanced.instructions ?? '').length > ADVANCED_LIMITS.instructions) errors.instructions = `At most ${ADVANCED_LIMITS.instructions} characters.`;
  if ((advanced.description ?? '').length > ADVANCED_LIMITS.description) errors.description = `At most ${ADVANCED_LIMITS.description} characters.`;
  if (advanced.topics.length > ADVANCED_LIMITS.topics.count) errors.topics = `At most ${ADVANCED_LIMITS.topics.count} topics.`;
  else {
    const bad = advanced.topics.map(validateTopic).find(Boolean);
    if (bad) errors.topics = bad;
  }
  return errors;
}

/** A local build has no GitHub to open a pull request on: it always commits on main. */
export const effectiveDelivery = (delivery: BuildDelivery, visibility: BuildVisibility): BuildDelivery => (visibility === 'local' ? 'push_main' : delivery);

/** As sent: blank texts become null, the delivery what the visibility allows. */
export const advancedOut = (a: BuildAdvanced, visibility: BuildVisibility): BuildAdvanced => ({
  ...a,
  delivery: effectiveDelivery(a.delivery, visibility),
  instructions: a.instructions?.trim() || null,
  description: a.description?.trim() || null,
});

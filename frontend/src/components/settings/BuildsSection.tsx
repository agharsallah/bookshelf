/**
 * Settings → Builds (docs/BUILDS.md §4): what a new build starts with — the GitHub owner,
 * visibility, commit credit, the README's link to the paper, the default limits and the
 * advanced defaults (model, effort, workflow, delivery). Kept
 * on the server (`PATCH /settings {builds}`); a change shows at once and rolls back if refused.
 */
import { useEffect, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { BuildDefaults } from '../../lib/api/types/builds';
import type { SettingsPublic } from '../../lib/api/types/settings';
import { LIMITS, parseOptionalNumber, validateOwner, validateStops, VISIBILITY_OPTIONS } from '../../lib/builds/form';
import { advancedDefaultsOf } from '../../lib/builds/advanced';
import { AdvancedDefaultsRows } from './AdvancedDefaultsRows';
import { problemOf } from '../common/Problem';
import { Check, Row, Section, Segmented } from './Controls';
import styles from './Settings.module.css';

interface Inputs {
  owner: string;
  minutes: string;
  commits: string;
  budget: string;
}

const inputsOf = (d: BuildDefaults): Inputs => ({
  owner: d.owner ?? '',
  minutes: String(d.max_minutes),
  commits: String(d.max_commits),
  budget: d.max_budget_usd === null ? '' : String(d.max_budget_usd),
});

export function BuildsSection({ api = browserApi }: { api?: Pick<ApiClient, 'get' | 'patch'> }) {
  const [saved, setSaved] = useState<BuildDefaults | null>(null);
  const [inputs, setInputs] = useState<Inputs | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.get<SettingsPublic>('settings').then(
      (s) => {
        setSaved(s.builds);
        setInputs(inputsOf(s.builds));
      },
      (error: unknown) => setStatus(problemOf(error).message),
    );
  }, [api]);

  if (!saved || !inputs) {
    return (
      <Section id="builds" eyebrow="Builds" title="Building from papers">
        <p className={styles.status} role="status">
          {status}
        </p>
      </Section>
    );
  }

  const save = async (patch: Partial<BuildDefaults>) => {
    const before = saved;
    const next = { ...saved, ...patch };
    setSaved(next);
    try {
      const answer = await api.patch<SettingsPublic>('settings', { builds: next });
      setSaved(answer.builds);
      setInputs(inputsOf(answer.builds));
      setStatus('Saved. New builds start from these.');
    } catch (error) {
      setSaved(before);
      setInputs(inputsOf(before));
      setStatus(`Not saved: ${problemOf(error).message}`);
    }
  };

  const saveOwner = () => {
    const problem = validateOwner(inputs.owner);
    if (problem) {
      setStatus(`Not saved: ${problem}`);
      return;
    }
    const owner = inputs.owner.trim() || null;
    if (owner !== saved.owner) void save({ owner });
  };

  const saveLimits = () => {
    const limits = { maxMinutes: Number(inputs.minutes), maxCommits: Number(inputs.commits), maxBudget: parseOptionalNumber(inputs.budget), doneWhen: [] };
    const errors = validateStops(limits);
    const problem = errors.maxMinutes ?? errors.maxCommits ?? errors.maxBudget;
    if (problem) {
      setStatus(`Not saved: ${problem}`);
      return;
    }
    if (limits.maxMinutes === saved.max_minutes && limits.maxCommits === saved.max_commits && limits.maxBudget === saved.max_budget_usd) return;
    void save({ max_minutes: limits.maxMinutes, max_commits: limits.maxCommits, max_budget_usd: limits.maxBudget });
  };

  const set = (patch: Partial<Inputs>) => setInputs({ ...inputs, ...patch });

  return (
    <Section
      id="builds"
      eyebrow="Builds"
      title="Building from papers"
      hint="Where a paper's build puts its repository and when it stops. Every build can still change these before it starts."
    >
      <Row label="GitHub owner">
        <div className={styles.checks}>
          <input
            className={styles.select}
            aria-label="GitHub owner"
            placeholder="Your account"
            maxLength={LIMITS.owner.max}
            value={inputs.owner}
            onChange={(e) => set({ owner: e.target.value })}
            onBlur={saveOwner}
          />
          <p className={styles.sample}>An organisation or user; blank uses the account `gh` is signed in as.</p>
        </div>
      </Row>
      <Row label="Visibility">
        <Segmented label="Visibility" value={saved.visibility} options={VISIBILITY_OPTIONS} onChange={(visibility) => void save({ visibility })} />
      </Row>
      <Row label="Commits and README">
        <div className={styles.checks}>
          <Check
            label="Credit Claude in commits"
            hint="A Co-Authored-By trailer on each commit."
            checked={saved.claude_attribution}
            onChange={(claude_attribution) => void save({ claude_attribution })}
          />
          <Check label="Name and link the paper in the README" checked={saved.link_paper} onChange={(link_paper) => void save({ link_paper })} />
        </div>
      </Row>
      <Row label="Default limits">
        <div className={styles.checks}>
          <label className={styles.sample}>
            Minutes{' '}
            <input className={styles.select} type="number" min={LIMITS.minutes.min} max={LIMITS.minutes.max} value={inputs.minutes} onChange={(e) => set({ minutes: e.target.value })} onBlur={saveLimits} />
          </label>
          <label className={styles.sample}>
            Commits{' '}
            <input className={styles.select} type="number" min={LIMITS.commits.min} max={LIMITS.commits.max} value={inputs.commits} onChange={(e) => set({ commits: e.target.value })} onBlur={saveLimits} />
          </label>
          <label className={styles.sample}>
            Budget (USD, empty for no cap){' '}
            <input
              className={styles.select}
              type="number"
              step="0.5"
              min={LIMITS.budget.min}
              max={LIMITS.budget.max}
              value={inputs.budget}
              onChange={(e) => set({ budget: e.target.value })}
              onBlur={saveLimits}
            />
          </label>
        </div>
      </Row>
      <AdvancedDefaultsRows value={advancedDefaultsOf(saved.advanced)} onChange={(advanced) => void save({ advanced })} />
      <p className={styles.status} role="status">
        {status}
      </p>
    </Section>
  );
}

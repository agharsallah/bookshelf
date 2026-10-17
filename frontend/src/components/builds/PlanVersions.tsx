/**
 * A build's plan versions (docs/BUILDS.md §7b). `VersionStrip` is the row of pills
 * (`v1 Drafted · v2 Replanned · v3 Edited · current`): native radios, so Tab reaches the
 * group and the arrow keys move through it. `PlanHistory` wraps the current plan's view:
 * picking an older version swaps that view for the old plan, read-only, under a banner
 * (*Viewing v1 · Use this version · Back to current*), with a Compare toggle that diffs it
 * against the current plan. Without `onRestored` it is history only (the run view).
 */
import { useId, useState, type ReactNode } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildPlanVersion, BuildPublic } from '../../lib/api/types/builds';
import { restorePlanVersion } from '../../lib/builds/api';
import { basedOnNote, versionLabel, versionShortLabel } from '../../lib/builds/plan-diff';
import { Problem, problemOf } from '../common/Problem';
import fields from './Fields.module.css';
import { PlanDiff } from './PlanDiff';
import { PlanView } from './PlanView';
import styles from './Versions.module.css';
import { usePlanVersions } from './usePlanVersions';

/** How the strip names the build's own version: the plan now, or the one that was built. */
export type CurrentWord = 'current' | 'built';

/** "Replanned from v1 · feedback: fewer milestones". */
function versionLine(v: BuildPlanVersion): string {
  const note = basedOnNote(v);
  return [`${versionLabel(v)}${note ? ` ${note}` : ''}`, v.feedback ? `feedback: ${v.feedback}` : ''].filter(Boolean).join(' · ');
}

export interface VersionStripProps {
  versions: readonly BuildPlanVersion[];
  current: number | null;
  selected: number | null;
  onSelect: (version: number) => void;
  currentWord: CurrentWord;
  disabled?: boolean;
}

export function VersionStrip({ versions, current, selected, onSelect, currentWord, disabled = false }: VersionStripProps) {
  const name = useId();
  const picked = versions.find((v) => v.version === (selected ?? current));
  return (
    <fieldset className={styles.strip} disabled={disabled}>
      <legend className="visually-hidden">Plan versions</legend>
      <div className={styles.pills}>
        {versions.map((v) => (
          <label key={v.version} className={styles.pill} title={versionLine(v)} data-current={v.version === current || undefined}>
            <input
              type="radio"
              className="visually-hidden"
              name={name}
              value={v.version}
              checked={v.version === (selected ?? current)}
              onChange={() => onSelect(v.version)}
            />
            <span className={styles.pillVersion}>v{v.version}</span> {versionShortLabel(v)}
            {v.version === current ? <span className={styles.pillCurrent}> · {currentWord}</span> : null}
            {v.feedback ? <span className="visually-hidden">, feedback: {v.feedback}</span> : null}
          </label>
        ))}
      </div>
      {picked ? (
        <p className={styles.caption}>
          v{picked.version}: {versionLine(picked)}
        </p>
      ) : null}
    </fieldset>
  );
}

interface OldVersionProps {
  build: BuildPublic;
  version: BuildPlanVersion;
  currentWord: CurrentWord;
  onBack: () => void;
  onUse?: () => void;
  restoring: boolean;
}

function OldVersion({ build, version, currentWord, onBack, onUse, restoring }: OldVersionProps) {
  const [compare, setCompare] = useState(false);
  const back = currentWord === 'built' ? 'Back to the built version' : 'Back to current';
  const now = build.plan;
  return (
    <div className={styles.viewing}>
      <div className={styles.banner} role="region" aria-label={`Viewing v${version.version}`}>
        <p className={styles.bannerText}>
          Viewing <strong>v{version.version}</strong> · {versionLabel(version)}
          {currentWord === 'built' ? ' · not the version that was built' : ', read-only'}
        </p>
        <div className={fields.actions}>
          {onUse ? (
            <button type="button" className="btn btn-primary" data-demo-off disabled={restoring} onClick={onUse}>
              {restoring ? 'Restoring…' : 'Use this version'}
            </button>
          ) : null}
          {now ? (
            <button type="button" className="btn" aria-pressed={compare} onClick={() => setCompare(!compare)}>
              Compare with {currentWord}
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet" onClick={onBack}>
            {back}
          </button>
        </div>
      </div>
      {compare && now ? (
        <PlanDiff before={version.plan} after={now} beforeLabel={`v${version.version}`} afterLabel={`v${build.plan_version ?? '?'} (${currentWord})`} />
      ) : (
        <PlanView plan={version.plan} />
      )}
    </div>
  );
}

export interface PlanHistoryProps {
  build: BuildPublic;
  api: Pick<ApiClient, 'get' | 'post'>;
  /** Given: an older version can be made current again (the plan review). */
  onRestored?: (build: BuildPublic) => void;
  currentWord?: CurrentWord;
  /** Keeps the strip still (while you edit the current plan). */
  locked?: boolean;
  /** The current plan's own view, shown while no older version is picked. */
  children: ReactNode;
}

export function PlanHistory({ build, api, onRestored, currentWord = 'current', locked = false, children }: PlanHistoryProps) {
  const shown = build.plan_versions_count > 1;
  const { versions, problem } = usePlanVersions(api, build, shown);
  const [selected, setSelected] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  if (!shown) return <>{children}</>;

  const current = build.plan_version ?? versions?.find((v) => v.current)?.version ?? null;
  const viewing = selected !== null && selected !== current ? versions?.find((v) => v.version === selected) : undefined;

  const select = (version: number) => {
    setRestoreError(null);
    setSelected(version === current ? null : version);
  };

  const use = async (version: number) => {
    if (!onRestored) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const next = await restorePlanVersion(api, build.id, version);
      setSelected(null);
      onRestored(next);
    } catch (error) {
      setRestoreError(`Not restored: ${problemOf(error).message}`);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className={styles.history}>
      {problem ? (
        <Problem inline title="The plan's versions could not be loaded." problem={problem} />
      ) : versions ? (
        <VersionStrip versions={versions} current={current} selected={selected} onSelect={select} currentWord={currentWord} disabled={locked} />
      ) : (
        <p className={fields.status} role="status">
          Loading the plan’s {build.plan_versions_count} versions…
        </p>
      )}
      {restoreError ? (
        <p className={fields.error} role="alert">
          {restoreError}
        </p>
      ) : null}
      {viewing ? (
        <OldVersion
          key={viewing.version}
          build={build}
          version={viewing}
          currentWord={currentWord}
          restoring={restoring}
          onBack={() => setSelected(null)}
          onUse={onRestored ? () => void use(viewing.version) : undefined}
        />
      ) : (
        children
      )}
    </div>
  );
}

/**
 * The run view's read-only "Plan history": closed by default and loaded once opened. The
 * build's own version is marked as the one that was built; older ones can be read and
 * compared with it, never restored.
 */
export function PlanHistoryDisclosure({ build, api }: { build: BuildPublic; api: Pick<ApiClient, 'get' | 'post'> }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (build.plan_versions_count <= 1 || !build.plan) return null;
  return (
    <section className={styles.disclosure}>
      <button type="button" className={styles.disclosureToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        Plan history · {build.plan_versions_count} versions
      </button>
      {open ? (
        <div id={id}>
          <PlanHistory build={build} api={api} currentWord="built">
            <PlanView plan={build.plan} />
          </PlanHistory>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The paper's Build tab (docs/BUILDS.md §6): earlier builds on the side, the one you open
 * in the main column — its plan being drafted, the plan to review, or the run — and
 * "New build" for the form. Opens on the newest build, or the form when there is none.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { BuildPublic, BuildSummary } from '../../lib/api/types/builds';
import { getBuild } from '../../lib/builds/api';
import { phaseOf } from '../../lib/builds/state';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { toast } from '../document/toast';
import { BuildForm } from './BuildForm';
import { StateBadge } from './Field';
import fields from './Fields.module.css';
import { PlanDrafting } from './PlanDrafting';
import { PlanReview } from './PlanReview';
import { RunView } from './RunView';
import styles from './Studio.module.css';
import { POLL_MS } from './usePolledBuild';

export interface BuildStudioProps {
  documentId: string;
  paperRef: string;
  paperTitle: string;
  /** The paper's builds, newest first (loaded server-side). */
  initialBuilds: BuildSummary[];
  api?: Pick<ApiClient, 'get' | 'post' | 'put' | 'delete'>;
  pollMs?: number;
}

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export function BuildStudio({ documentId, paperRef, paperTitle, initialBuilds, api = browserApi, pollMs = POLL_MS }: BuildStudioProps) {
  const [builds, setBuilds] = useState<BuildSummary[]>(initialBuilds);
  const [selectedId, setSelectedId] = useState<string | null>(initialBuilds[0]?.id ?? null);
  const [selected, setSelected] = useState<BuildPublic | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);

  useEffect(() => {
    if (!selectedId) return;
    let live = true;
    setProblem(null);
    getBuild(api, selectedId).then(
      (b) => live && setSelected(b),
      (error: unknown) => live && setProblem(problemOf(error)),
    );
    return () => {
      live = false;
    };
  }, [api, selectedId]);

  const change = useCallback((next: BuildPublic) => {
    setSelected(next);
    setBuilds((list) => list.map((b) => (b.id === next.id ? next : b)));
  }, []);

  const created = (build: BuildPublic) => {
    setBuilds((list) => [build, ...list]);
    setSelected(build);
    setSelectedId(build.id);
  };

  const deleted = (id: string) => {
    const rest = builds.filter((b) => b.id !== id);
    setBuilds(rest);
    setSelected(null);
    setSelectedId(rest[0]?.id ?? null);
    toast('Build deleted.', 'info');
  };

  const open = (id: string | null) => {
    if (id !== selectedId) setSelected(null);
    setSelectedId(id);
  };

  const shown = selected && selected.id === selectedId ? selected : null;

  // A run you watched finish says so, even when you have scrolled away from its badge.
  const seen = useRef<{ id: string; state: string } | null>(null);
  useEffect(() => {
    const before = seen.current;
    if (shown && before?.id === shown.id && before.state !== shown.state && shown.state === 'done') toast('The build is done.', 'good');
    seen.current = shown ? { id: shown.id, state: shown.state } : null;
  }, [shown]);

  return (
    <div className={styles.studio}>
      <aside className={styles.side} aria-label="Your builds">
        <button type="button" className="btn btn-primary" onClick={() => open(null)} aria-pressed={selectedId === null}>
          New build
        </button>
        {builds.length > 0 ? (
          <ul className={styles.list}>
            {builds.map((b) => (
              <li key={b.id}>
                <button type="button" className={styles.item} aria-current={b.id === selectedId ? 'true' : undefined} onClick={() => open(b.id)}>
                  <span className={styles.itemGoal}>{b.goal}</span>
                  <span className={styles.itemMeta}>
                    <StateBadge state={b.state} />
                    <span>{day(b.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={fields.hint}>No builds yet. Each one becomes a git repository of its own.</p>
        )}
      </aside>

      <div className={styles.main}>
        {selectedId === null ? (
          <BuildForm paperRef={paperRef || documentId} paperTitle={paperTitle} api={api} onCreated={created} onCancel={builds.length ? () => open(builds[0]?.id ?? null) : undefined} />
        ) : problem ? (
          <Problem title="The build could not be loaded." problem={problem} />
        ) : !shown ? (
          <p className={fields.status}>Opening the build…</p>
        ) : (
          <article className={fields.panel} aria-labelledby="build-goal">
            <header className={styles.buildHead}>
              <h2 id="build-goal" className={styles.goal}>
                {shown.goal}
              </h2>
              {shown.options.stack ? <span className={fields.chip}>{shown.options.stack}</span> : null}
            </header>
            {phaseOf(shown.state) === 'plan' ? (
              <PlanDrafting build={shown} api={api} onChange={change} pollMs={pollMs} />
            ) : phaseOf(shown.state) === 'review' ? (
              <PlanReview build={shown} api={api} onChange={change} />
            ) : (
              <RunView build={shown} api={api} onChange={change} onDeleted={deleted} pollMs={pollMs} />
            )}
          </article>
        )}
      </div>
    </div>
  );
}

export default BuildStudio;

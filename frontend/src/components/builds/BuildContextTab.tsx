/**
 * The plan review and the run view, each with a **Context** tab beside it: what this build
 * actually received (`GET /builds/{id}/context`). Loaded the first time you open the tab,
 * then kept; the main view stays the default, so the context is there without getting
 * in the way.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildContextView, BuildPublic } from '../../lib/api/types/builds';
import { getBuildContext } from '../../lib/builds/api';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { Tabs } from '../review/common/Tabs';
import context from './Context.module.css';
import styles from './Viewer.module.css';
import { ContextViewer } from './ContextViewer';

type View = 'main' | 'context';

function BuildContext({ build, api }: { build: Pick<BuildPublic, 'id' | 'options'>; api: Pick<ApiClient, 'get'> }) {
  const [view, setView] = useState<BuildContextView | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  useEffect(() => {
    let live = true;
    getBuildContext(api, build.id).then(
      (v) => live && setView(v),
      (error: unknown) => live && setProblem(problemOf(error)),
    );
    return () => {
      live = false;
    };
  }, [api, build.id]);
  if (problem) return <Problem inline title="The context could not be loaded." problem={problem} />;
  if (!view) {
    return (
      <p className={styles.loading} role="status">
        Reading what the build received…
      </p>
    );
  }
  return (
    <div className={styles.contextTab}>
      <p className={context.lede}>Exactly what the planner and the agent read for this build. Read-only: a new build is where you change it.</p>
      <ContextViewer view={view} extraCommands={build.options.advanced?.extra_commands ?? []} />
    </div>
  );
}

export function WithContext({ label, build, api, children }: { label: string; build: Pick<BuildPublic, 'id' | 'options'>; api: Pick<ApiClient, 'get'>; children: ReactNode }) {
  const [active, setActive] = useState<View>('main');
  // Mounted once opened, then kept (hidden) so switching back does not load it again.
  const [opened, setOpened] = useState(false);
  const open = (key: View) => {
    setActive(key);
    if (key === 'context') setOpened(true);
  };
  return (
    <Tabs
      tabs={[
        { key: 'main', label },
        { key: 'context', label: 'Context' },
      ]}
      active={active}
      onChange={open}
      label="Build views"
    >
      <div hidden={active !== 'main'}>{children}</div>
      {opened ? (
        <div hidden={active !== 'context'}>
          <BuildContext build={build} api={api} />
        </div>
      ) : null}
    </Tabs>
  );
}

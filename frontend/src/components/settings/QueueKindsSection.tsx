/**
 * Settings → Job kinds: how the queue runs every kind of pipeline work, whether or not any
 * of it is queued (`GET`/`PATCH /jobs/queue`). The same setting as the Pipeline page's
 * Priorities panel, which lists only what is queued; a greyed job there links to its kind
 * here (`/settings#queue-kind-<kind>`). Workers follow a change on their next pick.
 */
import { useEffect, useRef, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { QueueStatus } from '../../lib/api/types/jobs';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { KindModeTile, KindModeTiles } from '../pipeline/KindModeTile';
import { kindSettingsId, steeringGroups, steeringRows } from '../pipeline/steering';
import { useQueueUpdate } from '../pipeline/useQueueUpdate';
import { Section } from './Controls';
import styles from './Settings.module.css';

export function QueueKindsSection({ api = browserApi }: { api?: Pick<ApiClient, 'get' | 'patch'> }) {
  const [queue, setQueue] = useState<QueueStatus | null>(null);
  const [loadProblem, setLoadProblem] = useState<ProblemInfo | null>(null);
  const { send, sending, problem } = useQueueUpdate(api, setQueue);

  useEffect(() => {
    api.get<QueueStatus>('jobs/queue').then(setQueue, (error: unknown) => setLoadProblem(problemOf(error)));
  }, [api]);

  // Arriving from a link to one kind: the tiles render after the page, so scroll once, when they do.
  const scrolled = useRef(false);
  useEffect(() => {
    if (!queue || scrolled.current) return;
    scrolled.current = true;
    if (window.location.hash.startsWith('#queue-kind-')) document.getElementById(window.location.hash.slice(1))?.scrollIntoView?.({ block: 'center' });
  }, [queue]);

  return (
    <Section
      id="queue-kinds"
      eyebrow="Pipeline"
      title="Job kinds"
      hint="How the queue runs each kind of work. First goes before other queued work; Hold keeps it waiting (its books’ later stages wait too); Skip drops it as it comes up, like Cancel, and is offered only where the book moves on without it. Run now on a job ignores all of this."
    >
      {loadProblem ? <Problem title="The queue could not be read." problem={loadProblem} inline /> : null}
      {queue
        ? steeringGroups(steeringRows(queue, { all: true })).map((group) => (
            <section key={group.label} aria-label={group.label} className={styles.kindGroup}>
              <h3 className={styles.kindGroupLabel}>{group.label}</h3>
              <KindModeTiles>
                {group.rows.map((row) => (
                  <KindModeTile key={row.kind} id={kindSettingsId(row.kind)} row={row} disabled={sending} onMode={(mode) => void send({ kinds: { [row.kind]: mode } })} />
                ))}
              </KindModeTiles>
            </section>
          ))
        : null}
      {problem ? <Problem title="Not saved." problem={problem} inline /> : null}
    </Section>
  );
}

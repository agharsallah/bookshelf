/**
 * Jobs by kind: one bar per kind on a shared scale, split by state (./StateBar.tsx), with
 * the total beside it. Kinds with no jobs in view are left out. With `onSelect`, a kind's
 * name filters the page to it (and clears the filter when chosen again).
 */
import { JOB_KINDS, type JobKind, type JobPublic } from '../../lib/api/types/jobs';
import { countKindStates, KIND_LABELS, totalOf } from './model';
import { Bumped, StateBar } from './StateBar';
import styles from './KindBars.module.css';

export interface KindBarsProps {
  jobs: readonly JobPublic[];
  selected?: JobKind | null;
  onSelect?: (kind: JobKind) => void;
}

export function KindBars({ jobs, selected = null, onSelect }: KindBarsProps) {
  const byKind = countKindStates(jobs);
  const rows = JOB_KINDS.flatMap((kind) => {
    const counts = byKind[kind];
    return counts ? [{ kind, counts }] : [];
  });
  if (rows.length === 0) return <p className={styles.empty}>No jobs match.</p>;
  const scale = Math.max(1, ...rows.map((r) => totalOf(r.counts)));
  return (
    <dl className={styles.list}>
      {rows.map(({ kind, counts }) => {
        const total = totalOf(counts);
        const said = [counts.done && `${counts.done} done`, counts.failed && `${counts.failed} failed`, counts.running + counts.queued && `${counts.running + counts.queued} live`]
          .filter(Boolean)
          .join(', ');
        return (
          <div key={kind} className={styles.row} title={said}>
            <dt>
              {onSelect ? (
                <button type="button" className={styles.pick} aria-pressed={selected === kind} onClick={() => onSelect(kind)}>
                  {KIND_LABELS[kind]}
                </button>
              ) : (
                KIND_LABELS[kind]
              )}
            </dt>
            <dd>
              <StateBar counts={counts} scale={scale} bare />
              <Bumped value={total} className={styles.num} />
              <span className="visually-hidden">{said}</span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

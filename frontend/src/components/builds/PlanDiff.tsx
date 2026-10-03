/**
 * What changed from an older plan version to the current one (docs/BUILDS.md §7b): the
 * summary, the stack, each milestone and the out-of-scope list. Every mark is also said in
 * words ("Added", "Removed", "Changed: commit"), so color is never the only signal.
 */
import type { BuildMilestone, BuildPlan } from '../../lib/api/types/builds';
import { changedLine, diffPlans, FIELD_LABELS, type ListDiff, type MilestoneDiff } from '../../lib/builds/plan-diff';
import planStyles from './Plan.module.css';
import styles from './Versions.module.css';

function Marker({ kind, children }: { kind: MilestoneDiff['kind']; children: string }) {
  return (
    <span className={styles.marker} data-kind={kind}>
      {children}
    </span>
  );
}

function ListChanges({ title, diff }: { title: string; diff: ListDiff }) {
  if (diff.added.length + diff.removed.length === 0) return null;
  return (
    <section aria-label={title}>
      <h4 className={planStyles.subhead}>{title}</h4>
      <ul className={styles.diffList}>
        {diff.added.map((item) => (
          <li key={`+${item}`} data-kind="added">
            <Marker kind="added">Added</Marker> <ins>{item}</ins>
          </li>
        ))}
        {diff.removed.map((item) => (
          <li key={`-${item}`} data-kind="removed">
            <Marker kind="removed">Removed</Marker> <del>{item}</del>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Body({ m }: { m: BuildMilestone }) {
  return (
    <>
      <code className={planStyles.commit}>{m.commit}</code>
      <p className={planStyles.deliverable}>{m.deliverable}</p>
    </>
  );
}

function MilestoneChange({ d }: { d: MilestoneDiff }) {
  if (d.kind === 'added') {
    return (
      <>
        <p className={planStyles.milestoneTitle}>
          <Marker kind="added">Added</Marker> <ins>{d.after.title}</ins>
        </p>
        <Body m={d.after} />
      </>
    );
  }
  if (d.kind === 'removed') {
    return (
      <p className={planStyles.milestoneTitle}>
        <Marker kind="removed">Removed</Marker> <del>{d.before.title}</del>
      </p>
    );
  }
  if (d.kind === 'same') {
    return (
      <p className={planStyles.milestoneTitle}>
        <Marker kind="same">Unchanged</Marker> {d.after.title}
      </p>
    );
  }
  return (
    <>
      <p className={planStyles.milestoneTitle}>
        <Marker kind="changed">{changedLine(d.fields)}</Marker> {d.after.title}
      </p>
      <dl className={styles.fieldChanges}>
        {d.fields.map((f) => (
          <div key={f}>
            <dt>{FIELD_LABELS[f]}</dt>
            <dd>
              <del>{d.before[f]}</del> <span aria-hidden="true">→</span>
              <span className="visually-hidden">now</span> <ins>{d.after[f]}</ins>
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export interface PlanDiffProps {
  before: BuildPlan;
  after: BuildPlan;
  /** "v1", "v3 (current)": how the two sides are named. */
  beforeLabel: string;
  afterLabel: string;
}

export function PlanDiff({ before, after, beforeLabel, afterLabel }: PlanDiffProps) {
  const diff = diffPlans(before, after);
  return (
    <div className={styles.diff} aria-label={`Changes from ${beforeLabel} to ${afterLabel}`} role="region">
      <p className={styles.diffLede}>
        From {beforeLabel} to {afterLabel}
        {diff.changed ? '' : ': the same plan.'}
      </p>
      {diff.summary.changed ? (
        <section aria-label="Summary">
          <h4 className={planStyles.subhead}>Summary</h4>
          <p className={styles.summaryChange}>
            <Marker kind="changed">Changed</Marker> <del>{diff.summary.before}</del> <ins>{diff.summary.after}</ins>
          </p>
        </section>
      ) : null}
      <ListChanges title="Stack" diff={diff.stack} />
      <section aria-label="Milestones">
        <h4 className={planStyles.subhead}>Milestones</h4>
        <ol className={styles.diffMilestones}>
          {diff.milestones.map((d, i) => (
            <li key={i} className={styles.diffMilestone} data-kind={d.kind}>
              <MilestoneChange d={d} />
            </li>
          ))}
        </ol>
      </section>
      <ListChanges title="Out of scope" diff={diff.outOfScope} />
    </div>
  );
}

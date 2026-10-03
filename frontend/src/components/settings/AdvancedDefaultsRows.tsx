/**
 * Settings → Builds, the advanced defaults (docs/BUILDS.md §7): the model, effort and
 * workflow a new build starts with. Each build's *Advanced* panel can still change them.
 */
import type { AdvancedDefaults } from '../../lib/api/types/builds';
import { COMMIT_OPTIONS, DELIVERY_OPTIONS, EFFORT_OPTIONS, LICENSE_OPTIONS, MODEL_OPTIONS, PUSH_OPTIONS, TESTS_OPTIONS } from '../../lib/builds/advanced';
import { Row, Segmented } from './Controls';
import styles from './Settings.module.css';

export function AdvancedDefaultsRows({ value, onChange }: { value: AdvancedDefaults; onChange: (next: AdvancedDefaults) => void }) {
  const set = (patch: Partial<AdvancedDefaults>) => onChange({ ...value, ...patch });
  return (
    <>
      <Row label="Model">
        <div className={styles.checks}>
          <Segmented label="Build model" value={value.model} options={MODEL_OPTIONS} onChange={(model) => set({ model })} />
          <p className={styles.sample}>The agent that writes the code. Auto uses the agent's own tier.</p>
        </div>
      </Row>
      <Row label="Effort">
        <Segmented label="Effort" value={value.effort} options={EFFORT_OPTIONS} onChange={(effort) => set({ effort })} />
      </Row>
      <Row label="Plan model">
        <Segmented label="Plan model" value={value.plan_model} options={MODEL_OPTIONS} onChange={(plan_model) => set({ plan_model })} />
      </Row>
      <Row label="Commits">
        <Segmented label="Commit style" value={value.commit_style} options={COMMIT_OPTIONS} onChange={(commit_style) => set({ commit_style })} />
      </Row>
      <Row label="Tests">
        <Segmented label="Tests" value={value.tests} options={TESTS_OPTIONS} onChange={(tests) => set({ tests })} />
      </Row>
      <Row label="License">
        <Segmented label="License" value={value.license} options={LICENSE_OPTIONS} onChange={(license) => set({ license })} />
      </Row>
      <Row label="Delivery">
        <div className={styles.checks}>
          <Segmented label="Delivery" value={value.delivery} options={DELIVERY_OPTIONS} onChange={(delivery) => set({ delivery })} />
          <p className={styles.sample}>A pull request works on a branch and opens the PR at the end. Local builds always commit on main.</p>
        </div>
      </Row>
      <Row label="Push">
        <Segmented label="Push" value={value.push} options={PUSH_OPTIONS} onChange={(push) => set({ push })} />
      </Row>
    </>
  );
}

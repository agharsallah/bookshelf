/** The presets (`GET /builds/presets`) as cards to pick from, plus "Something else". */
import type { BuildPreset } from '../../lib/api/types/builds';
import styles from './Form.module.css';
import fields from './Fields.module.css';

export function PresetPicker({ presets, value, onPick }: { presets: readonly BuildPreset[]; value: string | null; onPick: (preset: BuildPreset | null) => void }) {
  return (
    <fieldset className={fields.fieldset}>
      <legend className={fields.legend}>What to build</legend>
      <div className={styles.presets}>
        {presets.map((p) => (
          <label key={p.key} className={styles.preset}>
            <input type="radio" name="build-preset" value={p.key} checked={value === p.key} onChange={() => onPick(p)} />
            <span className={styles.presetLabel}>{p.label}</span>
            <span className={styles.presetHint}>{p.description}</span>
            {p.stack ? <span className={fields.chip}>{p.stack}</span> : null}
          </label>
        ))}
        <label className={styles.preset}>
          <input type="radio" name="build-preset" value="" checked={value === null} onChange={() => onPick(null)} />
          <span className={styles.presetLabel}>Something else</span>
          <span className={styles.presetHint}>Say in your own words what you want.</span>
        </label>
      </div>
    </fieldset>
  );
}

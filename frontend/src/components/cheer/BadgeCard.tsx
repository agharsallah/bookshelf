/**
 * One badge: its mark, its name in the chosen voice, the level it is at, and how close the
 * next one is. Locked badges are drawn faint, with what earns them, so they read as goals.
 * A `tone` pins one voice whatever the setting.
 */
import type { BadgeStatus } from './badges';
import { Cheer } from './Cheer';
import type { CheerTone } from './prefs';
import styles from './Badges.module.css';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function BadgeCard({ status, fresh = false, tone }: { status: BadgeStatus; fresh?: boolean; tone?: CheerTone }) {
  const { def, level, levels, label, next, progress } = status;
  const earned = level > 0;
  const tiered = levels > 1;
  return (
    <li className={styles.card} data-earned={earned ? '' : undefined} data-fresh={fresh ? '' : undefined} data-tone={tone}>
      <span className={styles.mark} aria-hidden="true">
        {tone !== 'playful' && <span data-cheer-only={tone ? undefined : 'quiet'}>{tiered && earned ? ROMAN[level] : earned ? '✓' : '·'}</span>}
        {tone !== 'quiet' && <span data-cheer-only={tone ? undefined : 'playful'}>{def.emoji}</span>}
      </span>
      <span className={styles.body}>
        <span className={styles.name}>
          <Cheer line={{ quiet: def.name, playful: def.playful }} tone={tone} />
          {fresh && <span className={styles.new}>New</span>}
        </span>
        <span className={styles.label}>
          {earned ? label : `To earn: ${label}`}
          {tiered && earned && (
            <span className={styles.level}>
              <Cheer line={{ quiet: ` · level ${level} of ${levels}`, playful: ` · Lv ${level}/${levels}` }} tone={tone} />
            </span>
          )}
        </span>
        {next && (earned || progress > 0) && (
          <span className={styles.next}>
            <span className={styles.bar} role="progressbar" aria-label={`Toward ${next}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ inlineSize: `${(progress * 100).toFixed(1)}%` }} />
            </span>
            {earned && tiered && <span className={styles.nextLabel}>Next: {next}</span>}
          </span>
        )}
      </span>
    </li>
  );
}

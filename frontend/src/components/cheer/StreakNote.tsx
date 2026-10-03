/**
 * Under the week on Today (island): where your run of days stands and, with a daily goal
 * set in Settings, today's minutes against it. The goal lives in this browser, so it is
 * read after hydration; the streak line is in the markup from the start.
 */
import { useEffect, useState } from 'react';
import { Cheer } from './Cheer';
import { goalLine, streakLine, type StreakState } from './lines';
import { readGoal, type CheerTone, type DailyGoal } from './prefs';
import styles from './Cheer.module.css';

export interface StreakNoteProps extends StreakState {
  /** Tracked seconds today. */
  todaySeconds: number;
  /** Pins the goal and tone instead of reading them from this browser (the styleguide). */
  goal?: DailyGoal;
  tone?: CheerTone;
}

export function StreakNote({ todaySeconds, goal: pinned, tone, ...state }: StreakNoteProps) {
  const [stored, setStored] = useState<DailyGoal>(0);
  useEffect(() => {
    if (pinned === undefined) setStored(readGoal());
  }, [pinned]);
  const goal = pinned ?? stored;
  const streak = streakLine(state);
  const target = goalLine(goal, todaySeconds);
  if (!streak && !target) return null;
  const share = goal ? Math.min(1, todaySeconds / (goal * 60)) : 0;
  return (
    <span className={styles.streak}>
      {streak && (
        <span className={styles.streakLine}>
          <Cheer line={streak} tone={tone} />
        </span>
      )}
      {target && (
        <span className={styles.goal} data-done={share >= 1 ? '' : undefined}>
          <span className={styles.meter} aria-hidden="true">
            <span style={{ inlineSize: `${(share * 100).toFixed(1)}%` }} />
          </span>
          <Cheer line={target} tone={tone} />
        </span>
      )}
    </span>
  );
}

export default StreakNote;

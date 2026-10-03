/**
 * Encouragement: the tone the app cheers you on in (quiet words, or playful ones with
 * emoji and a burst of colour on a big win) and an optional daily reading goal, shown on
 * Today. Both are kept in this browser (components/cheer/prefs).
 */
import { useEffect, useState } from 'react';
import { Cheer } from '../cheer/Cheer';
import { streakLine } from '../cheer/lines';
import { CHEER_TONES, cheerTone, GOAL_CHOICES, readGoal, saveGoal, setCheerTone, type CheerTone, type DailyGoal } from '../cheer/prefs';
import { Row, Section, Segmented, titled } from './Controls';
import styles from './Settings.module.css';

/** How a six-day streak reads in each tone. */
const SAMPLE = streakLine({ streak: 6, longest: 6, activeToday: true });
const GOALS = GOAL_CHOICES.map((g) => ({ value: String(g), label: g === 0 ? 'None' : `${g} min` }));

export function EncouragementSection() {
  const [tone, setTone] = useState<CheerTone>('quiet');
  const [goal, setGoal] = useState<DailyGoal>(0);

  // Browser-only state is read after hydration, so the server's markup matches.
  useEffect(() => {
    setTone(cheerTone());
    setGoal(readGoal());
  }, []);

  return (
    <Section id="encouragement" eyebrow="Motivation" title="Encouragement" hint="Streaks, milestones and badges, and how loudly they are told. Kept in this browser.">
      <Row label="Tone">
        <div className={styles.checks}>
          <Segmented
            label="Tone"
            value={tone}
            options={titled(CHEER_TONES)}
            onChange={(next) => {
              setTone(next);
              setCheerTone(next);
            }}
          />
          {SAMPLE && (
            <p className={styles.sample}>
              <Cheer line={SAMPLE} />
            </p>
          )}
        </div>
      </Row>
      <Row label="Daily goal">
        <Segmented
          label="Daily goal"
          value={String(goal)}
          options={GOALS}
          onChange={(next) => {
            const minutes = GOAL_CHOICES.find((g) => String(g) === next) ?? 0;
            setGoal(minutes);
            saveGoal(minutes);
          }}
        />
      </Row>
    </Section>
  );
}

/**
 * One document's way through the §7 stages: a row of seven short bars, each split by the
 * state of that stage's jobs (./StateBar.tsx), so "Enrich: 30 done, 6 failed" reads at a
 * glance. A stage with no jobs in view is filled when the document status says it is
 * done (or its parse failed), empty while waiting. Live and failed counts are spelled out.
 */
import type { StageProgress } from './model';
import { Bumped, StateBar } from './StateBar';
import styles from './StageTrack.module.css';

const STATE_WORDS: Record<StageProgress['state'], string> = {
  waiting: 'waiting',
  active: 'in progress',
  done: 'done',
  failed: 'has failures',
};

function detail({ counts }: StageProgress): string {
  const parts = [
    counts.running && `${counts.running} running`,
    counts.queued && `${counts.queued} queued`,
    counts.done && `${counts.done} done`,
    counts.failed && `${counts.failed} failed`,
    counts.skipped && `${counts.skipped} skipped`,
  ].filter(Boolean);
  return parts.join(', ');
}

/** The one number worth reading under a stage: live work, else failures. */
function note({ counts }: StageProgress): { value: number; word: string } | null {
  const live = counts.running + counts.queued;
  if (live > 0) return { value: live, word: counts.running ? 'live' : 'queued' };
  if (counts.failed > 0) return { value: counts.failed, word: 'failed' };
  return null;
}

export function StageTrack({ stages, label }: { stages: readonly StageProgress[]; label: string }) {
  return (
    <ol className={styles.track} aria-label={`${label}: pipeline stages`}>
      {stages.map((progress) => {
        const counts = detail(progress);
        const said = note(progress);
        const fill = progress.state === 'done' ? 'done' : progress.state === 'failed' ? 'failed' : null;
        return (
          <li key={progress.stage.key} className={styles.station} data-state={progress.state} title={counts || STATE_WORDS[progress.state]}>
            <span className={styles.stationLabel}>{progress.stage.label}</span>
            <StateBar counts={progress.counts} fill={fill} />
            <span className={styles.note} aria-hidden="true">
              {said ? (
                <>
                  <Bumped value={said.value} /> {said.word}
                </>
              ) : null}
            </span>
            <span className="visually-hidden">
              {STATE_WORDS[progress.state]}
              {counts ? `: ${counts}` : ''}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

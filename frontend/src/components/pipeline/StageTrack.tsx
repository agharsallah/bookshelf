/**
 * One document's way through the §7 stages, drawn as stations on a line: filled when
 * done, ringed while active, crossed when a job failed, hollow while waiting.
 */
import type { StageProgress } from './model';
import styles from './Pipeline.module.css';

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

export function StageTrack({ stages, label }: { stages: readonly StageProgress[]; label: string }) {
  return (
    <ol className={styles.track} aria-label={`${label}: pipeline stages`}>
      {stages.map((progress) => {
        const counts = detail(progress);
        return (
          <li key={progress.stage.key} className={styles.station} data-state={progress.state} title={counts || STATE_WORDS[progress.state]}>
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.stationLabel}>{progress.stage.label}</span>
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

/**
 * Milestones on You (island): levels earned since your last look, the three badges nearest
 * their next level, and the way to the whole collection. Counts all your reading.
 */
import { useEffect, useMemo, useState } from 'react';
import { BadgeCard } from './BadgeCard';
import { badgeStatuses, collectionScore, newlyEarned, readSeen, saveSeen, seenLevels, upNext, type BadgeSource, type BadgeStatus } from './badges';
import { burst } from './burst';
import { Cheer } from './Cheer';
import styles from './Badges.module.css';

export function Milestones({ source }: { source: BadgeSource }) {
  const statuses = useMemo(() => badgeStatuses(source), [source]);
  const [fresh, setFresh] = useState<BadgeStatus[]>([]);

  useEffect(() => {
    const found = newlyEarned(statuses, readSeen(window.localStorage));
    saveSeen(window.localStorage, seenLevels(statuses));
    setFresh(found);
    if (found.length > 0) burst();
  }, [statuses]);

  const { earned, total } = collectionScore(statuses);
  const shown = new Set(fresh.map((b) => b.def.id));
  const next = upNext(statuses.filter((b) => !shown.has(b.def.id)));
  return (
    <div className={styles.milestones}>
      {fresh.length > 0 && (
        <>
          <h3 className={styles.subhead}>
            <Cheer line={{ quiet: 'Earned since you last looked', playful: '🎉 Just unlocked!' }} />
          </h3>
          <ul className={styles.grid}>
            {fresh.map((status) => (
              <BadgeCard key={status.def.id} status={status} fresh />
            ))}
          </ul>
        </>
      )}
      {next.length > 0 && (
        <>
          <h3 className={styles.subhead}>
            <Cheer line={{ quiet: 'Within reach', playful: '🎯 Almost there' }} />
          </h3>
          <ul className={styles.grid}>
            {next.map((status) => (
              <BadgeCard key={status.def.id} status={status} />
            ))}
          </ul>
        </>
      )}
      <a className={styles.all} href="/you/badges">
        All badges · {earned} of {total} levels
      </a>
    </div>
  );
}

export default Milestones;

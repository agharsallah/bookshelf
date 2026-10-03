/**
 * The badge collection (island, on /you/badges): every badge, earned first, with levels
 * earned since your last visit marked new. Visiting counts as seeing them.
 */
import { useEffect, useMemo, useState } from 'react';
import { BadgeCard } from './BadgeCard';
import { badgeStatuses, collectionScore, newlyEarned, readSeen, saveSeen, seenLevels, type BadgeSource } from './badges';
import { burst } from './burst';
import { Cheer } from './Cheer';
import styles from './Badges.module.css';

export function BadgeGrid({ source }: { source: BadgeSource }) {
  const statuses = useMemo(() => badgeStatuses(source), [source]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const found = newlyEarned(statuses, readSeen(window.localStorage));
    saveSeen(window.localStorage, seenLevels(statuses));
    setFresh(new Set(found.map((b) => b.def.id)));
    if (found.length > 0) burst();
  }, [statuses]);

  const { earned, total } = collectionScore(statuses);
  const ordered = [...statuses].sort((a, b) => Number(b.level > 0) - Number(a.level > 0) || b.progress - a.progress);
  return (
    <>
      <p className={styles.score} role="status">
        <Cheer
          line={
            earned === 0
              ? { quiet: 'Nothing earned yet. Finish a chapter and the first one is yours.', playful: '🎒 Your collection is empty. Finish a chapter to unlock your first badge!' }
              : { quiet: `${earned} of ${total} levels earned.`, playful: `🏅 ${earned} / ${total} levels unlocked. Keep collecting!` }
          }
        />
      </p>
      <ul className={styles.grid}>
        {ordered.map((status) => (
          <BadgeCard key={status.def.id} status={status} fresh={fresh.has(status.def.id)} />
        ))}
      </ul>
    </>
  );
}

export default BadgeGrid;

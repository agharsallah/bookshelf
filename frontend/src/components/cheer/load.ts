/** What badges are computed from: the all-history reader statistics, or null when they fail. */
import { serverApi } from '../../lib/api/server';
import type { LibraryReaderStats } from '../../lib/api/types/readerStats';
import type { BadgeSource } from './badges';

export const badgeSource = ({ totals, hours, depth }: Pick<LibraryReaderStats, 'totals' | 'hours' | 'depth'>): BadgeSource => ({ totals, hours, depth });

export async function loadBadgeSource(tz: string): Promise<BadgeSource | null> {
  return await serverApi()
    .get<LibraryReaderStats>('reader-stats', { query: { tz } })
    .then(badgeSource, () => null);
}

/**
 * `useAttention(where)`: while the component is mounted, attention on this page goes to
 * `where` (the app's `activityTracker`). `null` watches nothing. A change of place (the
 * block being read) moves the count from then on.
 */
import { useEffect } from 'react';
import type { Where } from './log';
import { activityTracker } from './tracker';

export function useAttention(where: Where | null): void {
  const { surface, document, unit, anchor, detail } = where ?? {};
  useEffect(() => {
    if (!surface) return;
    return activityTracker()?.watch({ surface, document, unit, anchor, detail });
  }, [surface, document, unit, anchor, detail]);
}

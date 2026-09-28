/**
 * `<ActivityBeacon client:load surface="distill" document={slug} detail="brief" />`: counts
 * attention on a page that has no island of its own to do it. Renders nothing.
 */
import type { Where } from './log';
import { useAttention } from './useAttention';

export function ActivityBeacon(where: Where) {
  useAttention(where);
  return null;
}

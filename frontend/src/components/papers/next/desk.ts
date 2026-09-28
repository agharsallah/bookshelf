/**
 * The Desk's "Next paper" card (docs/PAPERS.md §8): the best candidate of the reading
 * queue, with its reason. Null when there is none or the queue cannot be read, so the
 * card is simply absent.
 */
import type { ApiClient } from '../../../lib/api/client';
import type { ReadingCandidatePublic } from '../../../lib/api/types/papers';
import { listCandidates } from '../../../lib/papers/api';

export async function loadNextPaper(api: Pick<ApiClient, 'get'>): Promise<ReadingCandidatePublic | null> {
  try {
    const page = await listCandidates(api, { limit: 5 });
    // A suggestion you have not acted on yet comes first; a queued one is already planned.
    return page.items.find((c) => c.status === 'suggested') ?? page.items[0] ?? null;
  } catch {
    return null;
  }
}

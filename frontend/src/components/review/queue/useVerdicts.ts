/**
 * Approve / reject from the queue, with a real undo. A verdict is sent at once and the
 * item leaves the queue; Undo reopens it (`POST /artifacts/{id}/review {reopen}`), which
 * puts it back as a draft. A reopen the backend refuses (409: another live version now
 * covers the input) is reported, and the item stays reviewed.
 */
import { useCallback, useRef } from 'react';
import type { ApiClient } from '../../../lib/api/client';
import type { ArtifactListItem } from '../../../lib/api/types/artifacts';
import { problemOf } from '../../common/Problem';
import { reviewArtifact } from '../api';
import type { Toast } from '../common/Toasts';
import { propagationNote } from '../labels';

export type Verdict = 'approve' | 'reject';

const PAST: Record<Verdict, string> = { approve: 'Approved', reject: 'Rejected' };

export interface VerdictHandlers {
  api: ApiClient;
  push: (toast: Toast) => void;
  /** How one item is named in a toast ("Section note 1.2"). */
  label: (item: ArtifactListItem) => string;
  /** Items leave the queue (optimistically, before the answer). */
  hide: (ids: readonly string[]) => void;
  /** Items come back: a refused verdict, or an undone one (with its reopened state). */
  restore: (items: readonly ArtifactListItem[]) => void;
  /** Items are reviewed for good (the verdict was stored). */
  settleItems: (ids: readonly string[]) => void;
}

const failure = (what: string, reason: unknown) => {
  const problem = problemOf(reason);
  return `${what}: ${problem.message}${problem.requestId ? ` (request ${problem.requestId})` : ''}`;
};

export function useVerdicts({ api, push, label, hide, restore, settleItems }: VerdictHandlers) {
  const counter = useRef(0);

  return useCallback(
    (verdict: Verdict, targets: readonly ArtifactListItem[]) => {
      if (targets.length === 0) return;
      counter.current += 1;
      const key = `${verdict}:${counter.current}`;
      const first = targets[0];
      const what = targets.length === 1 && first ? label(first) : `${targets.length} items`;
      hide(targets.map((t) => t.id));

      const sent = Promise.allSettled(targets.map((t) => reviewArtifact(api, t.id, { action: verdict })));

      const undo = async () => {
        const results = await sent;
        const stored = targets.filter((_, n) => results[n]?.status === 'fulfilled');
        const reopened = await Promise.allSettled(stored.map((t) => reviewArtifact(api, t.id, { action: 'reopen' })));
        const back = stored.flatMap((t, n) => {
          const result = reopened[n];
          return result?.status === 'fulfilled' ? [{ ...t, ...result.value }] : [];
        });
        if (back.length) restore(back);
        const refused = reopened.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (refused) push({ id: `${key}:undo-error`, tone: 'error', message: failure('Could not undo', refused.reason) });
      };

      push({ id: key, message: `${PAST[verdict]} ${what}.`, undo: () => void undo() });

      void sent.then((results) => {
        const stored = targets.filter((_, n) => results[n]?.status === 'fulfilled');
        const refused = targets.filter((_, n) => results[n]?.status === 'rejected');
        settleItems(stored.map((t) => t.id));
        if (refused.length) restore(refused);
        const error = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (error) push({ id: `${key}:error`, tone: 'error', message: failure(`Not ${PAST[verdict].toLowerCase()}`, error.reason) });
        const note = verdict === 'approve' && targets.length === 1 && first ? propagationNote(first.type) : null;
        if (note && stored.length) push({ id: `${key}:next`, tone: 'info', message: note });
      });
    },
    [api, push, label, hide, restore, settleItems],
  );
}

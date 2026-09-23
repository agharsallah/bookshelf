/**
 * The review queue island (§12): everything waiting for a human, keyboard-first.
 * Approve / reject are optimistic: the item leaves at once and the request is held for
 * the undo window (see ../pending.ts), then sent. Focus follows the cursor.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { anchorLabel } from '../../../lib/anchors';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { ArtifactListItem, ReviewAction } from '../../../lib/api/types/artifacts';
import type { SkillPublic } from '../../../lib/api/types/skills';
import { problemOf } from '../../document/Problem';
import { reviewArtifact, type DocumentLabel } from '../api';
import { ShortcutHelp } from '../common/ShortcutHelp';
import { Toaster, useToasts } from '../common/Toasts';
import { deriveGates } from '../gates';
import { propagationNote, TYPE_LABELS } from '../labels';
import { createScheduler } from '../pending';
import { filterQueue, flatOrder, groupQueue, type QueueFilters as Filters } from '../queue';
import { currentId, initialTriage, keyToCommand, triageReducer, type TriageCommand } from '../triage';
import { ArtifactPreview, reviewHref } from './ArtifactPreview';
import { QueueFilters } from './QueueFilters';
import { QueueRow } from './QueueRow';
import styles from './Queue.module.css';

export interface ReviewQueueProps {
  items: ArtifactListItem[];
  documents: DocumentLabel[];
  /** Scope headings per document: `{docId: {anchor: heading}}`. */
  headings: Record<string, Record<string, string>>;
  skills: SkillPublic[];
  api?: ApiClient;
  /** How long an approve/reject can be undone before it is sent. */
  undoMs?: number;
  navigate?: (href: string) => void;
}

/** Below this width the preview pane is hidden, so a row opens the full review. */
const NARROW = '(max-width: 60rem)';

const PAST: Record<Exclude<ReviewAction, 'edit'>, string> = { approve: 'Approved', reject: 'Rejected' };

export function ReviewQueue({ items: initial, documents, headings, skills, api = browserApi, undoMs = 6000, navigate = (h) => window.location.assign(h) }: ReviewQueueProps) {
  const [items, setItems] = useState(initial);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState<Filters>({});
  const { toasts, push, dismiss, settle } = useToasts(undoMs + 400);
  const scheduler = useMemo(() => createScheduler(undoMs), [undoMs]);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const wantFocus = useRef(false);

  const titles = useMemo(() => Object.fromEntries(documents.map((d) => [d.id, d.title])), [documents]);
  const thresholds = useMemo(() => Object.fromEntries(skills.map((s) => [s.name, s.gates])), [skills]);
  const visible = useMemo(() => filterQueue(items.filter((i) => !hidden.has(i.id)), filters), [items, hidden, filters]);
  const groups = useMemo(() => groupQueue(visible, titles), [visible, titles]);
  const order = useMemo(() => flatOrder(groups), [groups]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [triage, dispatch] = useReducer(triageReducer, order, initialTriage);
  useEffect(() => dispatch({ type: 'sync', order }), [order]);
  const focusedId = currentId(triage);
  const focused = focusedId ? byId.get(focusedId) : undefined;

  useEffect(() => {
    if (!wantFocus.current || !focusedId) return;
    wantFocus.current = false;
    rows.current.get(focusedId)?.focus();
  }, [focusedId, triage.order]);

  useEffect(() => {
    const flush = () => scheduler.flush();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [scheduler]);

  const heading = (item: ArtifactListItem) => (item.anchor ? headings[item.document_id]?.[item.anchor] : undefined);
  const label = (item: ArtifactListItem) => `${TYPE_LABELS[item.type]}${item.anchor ? ` ${anchorLabel(item.anchor)}` : ''}`;

  const act = useCallback(
    (action: Exclude<ReviewAction, 'edit'>, ids: string[]) => {
      const targets = ids.map((id) => byId.get(id)).filter((i): i is ArtifactListItem => Boolean(i));
      if (targets.length === 0) return;
      const key = `${action}:${ids.join(',')}`;
      wantFocus.current = true;
      dispatch({ type: 'remove', ids });
      setHidden((h) => new Set([...h, ...ids]));
      const unhide = (gone: string[]) => setHidden((h) => new Set([...h].filter((id) => !gone.includes(id))));
      const first = targets[0];
      const what = targets.length === 1 && first ? label(first) : `${targets.length} drafts`;

      push({
        id: key,
        message: `${PAST[action]} ${what}.`,
        undo: () => {
          if (!scheduler.cancel(key)) return;
          wantFocus.current = true;
          dispatch({ type: 'restore' });
          unhide(ids);
        },
      });
      scheduler.schedule(key, () => {
        settle(key);
        void Promise.allSettled(targets.map((t) => reviewArtifact(api, t.id, { action }))).then((results) => {
          const done = targets.filter((_, n) => results[n]?.status === 'fulfilled').map((t) => t.id);
          const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
          setItems((all) => all.filter((i) => !done.includes(i.id)));
          unhide(ids);
          if (failed) {
            const problem = problemOf(failed.reason);
            push({ id: `${key}:error`, tone: 'error', message: `Not ${PAST[action].toLowerCase()}: ${problem.message}${problem.requestId ? ` (request ${problem.requestId})` : ''}` });
          }
          const note = action === 'approve' && targets.length === 1 && first ? propagationNote(first.type) : null;
          if (note && done.length) push({ id: `${key}:next`, tone: 'info', message: note });
        });
      });
    },
    [api, byId, push, scheduler, settle],
  );

  const approvable = triage.selected.filter((id) => {
    const item = byId.get(id);
    return item?.review === 'draft' && deriveGates(item, item.skill ? thresholds[item.skill] : null).passesAll;
  });

  const run = useCallback(
    (command: TriageCommand) => {
      const id = currentId(triage);
      switch (command) {
        case 'next':
        case 'prev':
          wantFocus.current = true;
          return dispatch({ type: 'move', by: command === 'next' ? 1 : -1 });
        case 'approve':
        case 'reject':
          return id ? act(command, [id]) : undefined;
        case 'edit':
          return id ? navigate(reviewHref(id, { mode: 'edit' })) : undefined;
        case 'open':
          return id ? navigate(reviewHref(id)) : undefined;
        case 'select':
          return id ? dispatch({ type: 'toggleSelect', id }) : undefined;
        case 'undo': {
          const last = [...toasts].reverse().find((t) => t.undo);
          last?.undo?.();
          return last ? dismiss(last.id) : undefined;
        }
        case 'help':
          return dispatch({ type: 'help' });
        case 'escape':
          return triage.help ? dispatch({ type: 'help', open: false }) : dispatch({ type: 'clearSelection' });
      }
    },
    [act, dismiss, navigate, toasts, triage],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('dialog') && event.key !== '?') return;
      const command = keyToCommand({
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        targetTag: target?.tagName,
        targetEditable: target?.isContentEditable,
      });
      if (!command) return;
      if (command === 'open' && target?.tagName === 'A') return;
      event.preventDefault();
      run(command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  const needs = visible.filter((i) => i.review === 'needs_review').length;
  const drafts = visible.length - needs;

  return (
    <div className={styles.queue}>
      <div className={styles.summaryRow}>
        <p className={styles.summary}>
          {visible.length === 0
            ? 'Nothing is waiting for review.'
            : `${needs} need${needs === 1 ? 's' : ''} review, ${drafts} draft${drafts === 1 ? '' : 's'}, across ${groups.length} document${groups.length === 1 ? '' : 's'}.`}
        </p>
        <button type="button" className={styles.helpButton} onClick={() => dispatch({ type: 'help' })} aria-keyshortcuts="?">
          Shortcuts <kbd className={styles.kbd}>?</kbd>
        </button>
      </div>
      <QueueFilters items={items} titles={titles} value={filters} onChange={setFilters} />

      {triage.selected.length > 0 ? (
        <div className={styles.bulk} role="region" aria-label="Bulk approval">
          <p>
            {triage.selected.length} selected; {approvable.length} {approvable.length === 1 ? 'is a draft that passes' : 'are drafts that pass'} every gate.
          </p>
          <button type="button" className={styles.approve} disabled={approvable.length === 0} onClick={() => act('approve', approvable)}>
            Approve {approvable.length}
          </button>
          <button type="button" className={styles.action} onClick={() => dispatch({ type: 'clearSelection' })}>
            Clear selection
          </button>
        </div>
      ) : null}

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <p>{items.length === 0 ? 'Every artifact has been reviewed. New drafts appear here as the pipeline writes them.' : 'No queued artifact matches these filters.'}</p>
          <a href="/pipeline">See what the pipeline is working on</a>
        </div>
      ) : (
        <div className={styles.panes}>
          <nav className={styles.list} aria-label="Queue">
            {groups.map((group) => (
              <section key={group.documentId} className={styles.group} aria-labelledby={`group-${group.documentId}`}>
                <h2 id={`group-${group.documentId}`} className={styles.groupTitle}>
                  {group.title}
                  <span className={styles.groupCount}>{group.items.length}</span>
                </h2>
                <ul className={styles.rows}>
                  {group.items.map((item) => (
                    <QueueRow
                      key={item.id}
                      ref={(el) => {
                        if (el) rows.current.set(item.id, el);
                        else rows.current.delete(item.id);
                      }}
                      item={item}
                      heading={heading(item)}
                      focused={item.id === focusedId}
                      selected={triage.selected.includes(item.id)}
                      thresholds={item.skill ? thresholds[item.skill] : null}
                      onFocus={(id) => dispatch({ type: 'focus', id })}
                      onActivate={(id) => (window.matchMedia?.(NARROW).matches ? navigate(reviewHref(id)) : dispatch({ type: 'focus', id }))}
                      onOpen={(id) => navigate(reviewHref(id))}
                      onToggle={(id) => dispatch({ type: 'toggleSelect', id })}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </nav>
          {focused ? (
            <ArtifactPreview
              key={focused.id}
              item={focused}
              heading={heading(focused)}
              documentTitle={titles[focused.document_id] ?? 'Untitled document'}
              thresholds={focused.skill ? thresholds[focused.skill] : null}
              busy={false}
              onApprove={() => act('approve', [focused.id])}
              onReject={() => act('reject', [focused.id])}
              onEdit={() => navigate(reviewHref(focused.id, { mode: 'edit' }))}
            />
          ) : null}
        </div>
      )}

      <ShortcutHelp open={triage.help} onClose={() => dispatch({ type: 'help', open: false })} />
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

export default ReviewQueue;

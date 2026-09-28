/**
 * Everything the reader needs to remember a chapter, in one hook:
 *
 * - **Predict**: an unread chapter that can be graded opens on a card with only its title
 *   and section headings; what you expect it to argue is saved before the text shows.
 * - **Recall**: at the end of the chapter (or `r`), a sheet covers the text while you
 *   write what you remember. Saving queues its grade; the sheet follows the job and shows
 *   the result, and "gaps marked" reopens the chapter with the missed and half-recalled
 *   passages drawn by the what-matters mode.
 *
 * `hidden` is true while either covers the chapter: the reader hides and disables its text.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { browserApi } from '../../lib/api/client';
import type { TreeNode } from '../../lib/api/types/documents';
import type { JobPublic } from '../../lib/api/types/jobs';
import type { RecallPublic } from '../../lib/api/types/recalls';
import { useJobStream } from '../../lib/hooks/useJobStream';
import { problemOf } from '../common/Problem';
import { toast } from '../document/toast';
import type { Salient } from '../reader/salience';
import { gradeAgain, listRecalls, writeRecall, type RecallApi } from './api';
import { gapMarks, hasPrediction, latestGraded, tally } from './grade';
import { PredictCard } from './PredictCard';
import { RecallSheet, type SheetState } from './RecallSheet';
import styles from './Recall.module.css';

export interface RecallModeOptions {
  document: { id: string; slug: string };
  unit: { anchor: string; heading: string };
  sectionHeadings: readonly string[];
  /** The chapter's recalls and predictions, newest first. */
  recalls: RecallPublic[];
  /** It has marks or a distillation to grade against. */
  gradable: boolean;
  /** Offer a prediction: the chapter is unread and the reader wants to be asked. */
  askPrediction: boolean;
  nodes: readonly TreeNode[];
  /** The gaps were asked for: turn the what-matters marks on. */
  onShowGaps: () => void;
  api?: RecallApi;
}

export interface RecallMode {
  hidden: boolean;
  open: () => void;
  overlay: ReactNode;
  footer: ReactNode;
  /** Marks for the ideas the latest recall missed, while shown; else null. */
  gaps: Salient[] | null;
}

type Phase =
  | { name: 'idle' }
  | { name: 'saving' }
  | { name: 'grading'; recallId: string; jobId: string }
  | { name: 'failed'; recallId: string; message: string };

export function useRecallMode(options: RecallModeOptions): RecallMode {
  const { document: doc, unit, sectionHeadings, gradable, askPrediction, nodes, onShowGaps, api = browserApi } = options;
  const [recalls, setRecalls] = useState(options.recalls);
  const [predicting, setPredicting] = useState(() => askPrediction && gradable && !hasPrediction(options.recalls));
  const [prediction, setPrediction] = useState('');
  const [savingPrediction, setSavingPrediction] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  /** What the sheet shows when no grade is on its way: a fresh page, or the last grade. */
  const [view, setView] = useState<'write' | 'grade'>('write');
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [showGaps, setShowGaps] = useState(false);
  const stream = useJobStream({ documentId: doc.id, enabled: phase.name === 'grading' });
  const { track } = stream;

  const latest = latestGraded(recalls);
  const gaps = useMemo(() => (showGaps && latest?.grade ? gapMarks(latest.grade, nodes) : null), [showGaps, latest, nodes]);

  const watch = useCallback(
    (recallId: string, job: JobPublic) => {
      track(job);
      setPhase({ name: 'grading', recallId, jobId: job.id });
    },
    [track],
  );

  // Follow the grading job; once it is done, the grade is on the recall.
  const job = phase.name === 'grading' ? stream.jobs[phase.jobId] : undefined;
  useEffect(() => {
    if (phase.name !== 'grading' || !job) return;
    if (job.state === 'failed') setPhase({ name: 'failed', recallId: phase.recallId, message: job.error ?? 'the grading job failed.' });
    if (job.state !== 'done') return;
    let live = true;
    listRecalls(api, doc.slug, unit.anchor)
      .then((list) => {
        if (!live) return;
        setRecalls(list);
        setView('grade');
        setPhase({ name: 'idle' });
      })
      .catch((error: unknown) => live && setPhase({ name: 'failed', recallId: phase.recallId, message: problemOf(error).message }));
    return () => {
      live = false;
    };
  }, [phase, job, api, doc.slug, unit.anchor]);

  const submit = async () => {
    setPhase({ name: 'saving' });
    try {
      const created = await writeRecall(api, doc.slug, unit.anchor, 'recall', draft);
      setRecalls((list) => [created, ...list]);
      setDraft('');
      if (created.job) watch(created.id, created.job);
      else setPhase({ name: 'idle' });
    } catch (error) {
      setPhase({ name: 'idle' });
      toast(`Your recall was not saved: ${problemOf(error).message}`, 'bad');
    }
  };

  const retry = async () => {
    if (phase.name !== 'failed') return;
    try {
      watch(phase.recallId, await gradeAgain(api, doc.slug, phase.recallId));
    } catch (error) {
      setPhase({ ...phase, message: problemOf(error).message });
    }
  };

  const savePrediction = async () => {
    setSavingPrediction(true);
    try {
      const created = await writeRecall(api, doc.slug, unit.anchor, 'prediction', prediction);
      setRecalls((list) => [created, ...list]);
      setPredicting(false);
    } catch (error) {
      toast(`Your prediction was not saved: ${problemOf(error).message}`, 'bad');
    } finally {
      setSavingPrediction(false);
    }
  };

  const open = useCallback(() => {
    if (!gradable) return;
    setShowGaps(false);
    setView('write');
    setSheetOpen(true);
  }, [gradable]);

  const seeGrade = () => {
    setView('grade');
    setSheetOpen(true);
  };

  const sheetState: SheetState =
    phase.name === 'grading'
      ? { step: 'grading', waitingForWorker: Boolean(stream.queue?.unclaimed_kinds.includes('grade_recall')) }
      : phase.name === 'failed'
        ? { step: 'failed', message: phase.message }
        : view === 'grade' && latest?.grade
          ? { step: 'graded', grade: latest.grade }
          : { step: 'write', saving: phase.name === 'saving' };

  const overlay = predicting ? (
    <PredictCard
      chapter={unit.heading}
      sections={sectionHeadings}
      draft={prediction}
      saving={savingPrediction}
      onDraft={setPrediction}
      onSave={() => void savePrediction()}
      onSkip={() => setPredicting(false)}
    />
  ) : sheetOpen ? (
    <RecallSheet
      chapter={unit.heading}
      state={sheetState}
      draft={draft}
      onDraft={setDraft}
      onSubmit={() => void submit()}
      onRetry={() => void retry()}
      onShowGaps={() => {
        setSheetOpen(false);
        setShowGaps(true);
        onShowGaps();
      }}
      onClose={() => setSheetOpen(false)}
    />
  ) : null;

  const last = latest?.grade ? tally(latest.grade) : null;
  const footer = gradable ? (
    <div className={styles.offer}>
      <button type="button" className="btn" aria-keyshortcuts="r" onClick={open}>
        {phase.name === 'grading' ? 'Recall: grading…' : 'Recall this chapter'}
      </button>
      {last ? (
        <span className={styles.last}>
          Last recall: {last.recalled} of {last.total} ideas.{' '}
          <button type="button" className={styles.link} onClick={seeGrade}>
            See the grade
          </button>
          {last.recalled < last.total ? (
            <>
              {' · '}
              <button
                type="button"
                className={styles.link}
                aria-pressed={showGaps}
                onClick={() => {
                  if (!showGaps) onShowGaps();
                  setShowGaps(!showGaps);
                }}
              >
                {showGaps ? 'Hide the gaps' : 'Mark the gaps'}
              </button>
            </>
          ) : null}
        </span>
      ) : (
        <span className={styles.last}>Write what you remember, with the text out of sight.</span>
      )}
    </div>
  ) : null;

  return { hidden: overlay !== null, open, overlay, footer, gaps };
}

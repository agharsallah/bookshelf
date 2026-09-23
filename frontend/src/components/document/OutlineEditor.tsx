/**
 * Outline fix-up editor (§8): rename, merge and split chapters, adjust page ranges,
 * skip chapters and add sections, then `PATCH /documents/{ref}/outline`. The override
 * survives re-parsing; saving queues a forced parse. Problems are checked as you type
 * with the backend's own rules, so a save is only offered for an outline it will
 * accept. While the outline waits for review, "Outline looks right" accepts the guess
 * unedited (`POST /documents/{ref}/outline/confirm`) and starts the pipeline.
 */
import { useMemo, useState } from 'react';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { DocumentAccepted, OutlineChapter, OutlineConfirmed } from '../../lib/api/types/documents';
import { ChapterRow } from './OutlineChapterRow';
import {
  addSection,
  mergeWithNext,
  removeChapter,
  removeSection,
  effectiveEnd,
  rename,
  sameOutline,
  setPages,
  setSkip,
  split,
  toPayload,
  updateSection,
  validate,
  type Outline,
} from './outline-model';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { toast } from './toast';
import styles from './OutlineEditor.module.css';

export interface OutlineEditorProps {
  slug: string;
  initial: OutlineChapter[];
  pageCount: number | null;
  /** True when an override is already stored (it can be removed). */
  hasOverride: boolean;
  /** The outline was guessed and waits for a human (document status `needs_review`). */
  needsReview?: boolean;
  api?: Pick<ApiClient, 'patch' | 'post'>;
}

export function OutlineEditor({ slug, initial, pageCount, hasOverride, needsReview = false, api = browserApi }: OutlineEditorProps) {
  const [outline, setOutline] = useState<Outline>(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [saved, setSaved] = useState<'saved' | 'confirmed' | null>(null);
  const problems = useMemo(() => validate(outline, pageCount), [outline, pageCount]);
  const dirty = !sameOutline(outline, initial);
  const invalid = new Set(problems.map((p) => p.chapter));

  const edit = (next: Outline) => {
    setOutline(next);
    setSaved(null);
  };

  const attempt = async (work: () => Promise<unknown>, message: string, done: 'saved' | 'confirmed') => {
    setSaving(true);
    setProblem(null);
    try {
      await work();
      toast(message, 'good');
      setSaved(done);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSaving(false);
    }
  };

  const send = (chapters: Outline, message: string) =>
    attempt(() => api.patch<DocumentAccepted>(`documents/${slug}/outline`, { chapters }), message, 'saved');

  const confirm = () =>
    attempt(() => api.post<OutlineConfirmed>(`documents/${slug}/outline/confirm`), 'Outline accepted. Distillation is starting.', 'confirmed');

  const addChapter = () => {
    const last = outline.at(-1);
    const after = last ? (last.page_to ?? last.page_from) : 1;
    const start = pageCount !== null ? Math.min(after, pageCount) : after;
    edit([...outline, { title: 'New chapter', page_from: start, page_to: null, sections: [] }]);
  };

  const confirmable = needsReview && !dirty && saved === null;

  return (
    <div className={styles.editor}>
      {confirmable ? (
        <div className={styles.confirm}>
          <p>If the chapters below match the book, accept them as they are; nothing is re-parsed.</p>
          <button type="button" className={styles.primary} disabled={saving} onClick={() => void confirm()}>
            {saving ? 'Confirming…' : 'Outline looks right'}
          </button>
        </div>
      ) : null}
      <ol className={styles.chapters}>
        {outline.map((chapter, index) => (
          <ChapterRow
            key={index}
            index={index}
            chapter={chapter}
            isLast={index === outline.length - 1}
            invalid={invalid.has(index)}
            end={effectiveEnd(outline, index, pageCount)}
            onTitle={(title) => edit(rename(outline, index, title))}
            onPages={(pages) => edit(setPages(outline, index, pages))}
            onSkip={(skip) => edit(setSkip(outline, index, skip))}
            onMerge={() => edit(mergeWithNext(outline, index))}
            onSplit={(page, title) => edit(split(outline, index, page, title))}
            onRemove={() => edit(removeChapter(outline, index))}
            onAddSection={() => edit(addSection(outline, index, { title: 'New section', page_from: chapter.page_from }))}
            onSection={(at, change) => edit(updateSection(outline, index, at, change))}
            onRemoveSection={(at) => edit(removeSection(outline, index, at))}
          />
        ))}
      </ol>

      <button type="button" className={styles.addChapter} onClick={addChapter}>
        Add chapter
      </button>

      <div className={styles.problems} aria-live="polite">
        {problems.length > 0 ? (
          <ul>
            {problems.slice(0, 6).map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
            {problems.length > 6 ? <li>…and {problems.length - 6} more.</li> : null}
          </ul>
        ) : dirty ? (
          <p>The outline is consistent{pageCount ? ` with the document’s ${pageCount} pages` : ''}.</p>
        ) : null}
      </div>

      {problem ? <Problem inline title="The outline was not saved." problem={problem} /> : null}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.primary}
          disabled={!dirty || problems.length > 0 || outline.length === 0 || saving}
          onClick={() => void send(toPayload(outline).chapters, 'Outline saved. Re-parsing with it.')}
        >
          {saving ? 'Saving…' : 'Save outline and re-parse'}
        </button>
        {dirty ? (
          <button type="button" className={styles.quiet} onClick={() => edit(initial)}>
            Discard changes
          </button>
        ) : null}
        {hasOverride ? (
          <button
            type="button"
            className={styles.quiet}
            disabled={saving}
            onClick={() => void send([], 'Manual outline removed. Re-parsing from the document.')}
          >
            Go back to the parsed outline
          </button>
        ) : null}
        {saved === 'saved' ? <span className={styles.saved}>Saved. The pipeline shows the re-parse.</span> : null}
        {saved === 'confirmed' ? <span className={styles.saved}>Accepted. The pipeline shows what it queued.</span> : null}
      </div>
    </div>
  );
}

export default OutlineEditor;

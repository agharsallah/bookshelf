/**
 * Outline fix-up editor (§8): rename, merge and split chapters, adjust page ranges
 * and add sections, then `PATCH /documents/{ref}/outline`. The override survives
 * re-parsing; saving queues a forced parse. Problems are checked as you type with
 * the backend's own rules, so a save is only offered for an outline it will accept.
 */
import { useMemo, useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { DocumentAccepted, OutlineChapter } from '../../lib/api/types/documents';
import { ChapterRow } from './OutlineChapterRow';
import {
  addSection,
  mergeWithNext,
  removeChapter,
  removeSection,
  rename,
  setPages,
  split,
  toPayload,
  updateSection,
  validate,
  type Outline,
} from './outline-model';
import { Problem, problemOf, type ProblemInfo } from './Problem';
import { toast } from './toast';
import styles from './OutlineEditor.module.css';

export interface OutlineEditorProps {
  slug: string;
  initial: OutlineChapter[];
  pageCount: number | null;
  /** True when an override is already stored (it can be removed). */
  hasOverride: boolean;
}

export function OutlineEditor({ slug, initial, pageCount, hasOverride }: OutlineEditorProps) {
  const [outline, setOutline] = useState<Outline>(initial);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [saved, setSaved] = useState(false);
  const problems = useMemo(() => validate(outline, pageCount), [outline, pageCount]);
  const dirty = JSON.stringify(outline) !== JSON.stringify(initial);
  const invalid = new Set(problems.map((p) => p.chapter));

  const edit = (next: Outline) => {
    setOutline(next);
    setSaved(false);
  };

  const send = async (chapters: Outline, message: string) => {
    setSaving(true);
    setProblem(null);
    try {
      await browserApi.patch<DocumentAccepted>(`documents/${slug}/outline`, { chapters });
      toast(message, 'good');
      setSaved(true);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSaving(false);
    }
  };

  const addChapter = () => {
    const last = outline.at(-1);
    const start = last ? Math.min(last.page_to, pageCount ?? last.page_to) : 1;
    edit([...outline, { title: 'New chapter', page_from: start, page_to: pageCount ?? start, sections: [] }]);
  };

  return (
    <div className={styles.editor}>
      <ol className={styles.chapters}>
        {outline.map((chapter, index) => (
          <ChapterRow
            key={index}
            index={index}
            chapter={chapter}
            isLast={index === outline.length - 1}
            invalid={invalid.has(index)}
            onTitle={(title) => edit(rename(outline, index, title))}
            onPages={(pages) => edit(setPages(outline, index, pages))}
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
        {saved ? <span className={styles.saved}>Saved. The pipeline above shows the re-parse.</span> : null}
      </div>
    </div>
  );
}

export default OutlineEditor;

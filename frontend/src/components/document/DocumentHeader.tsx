/**
 * The document's title page: title, authors, year and tags, editable in place.
 * Saving sends only what changed (`PATCH /documents/{ref}`).
 */
import { useState, type SubmitEvent } from 'react';
import { browserApi } from '../../lib/api/client';
import type { DocumentPublic, DocumentUpdate } from '../../lib/api/types/documents';
import { Problem, problemOf, type ProblemInfo } from './Problem';
import { toast } from './toast';
import styles from './DocumentHeader.module.css';

type Meta = Pick<DocumentPublic, 'title' | 'authors' | 'year' | 'tags'>;

export interface DocumentHeaderProps {
  slug: string;
  initial: Meta;
  /** "PDF, 212 pages" and similar, shown above the title. */
  facts: string;
}

/** "a, b ,, c" → ["a", "b", "c"], de-duplicated, order kept. */
export function parseList(text: string): string[] {
  return [...new Set(text.split(',').map((s) => s.trim()).filter(Boolean))];
}

export interface Draft {
  title: string;
  authors: string;
  year: string;
  tags: string;
}

/** The PATCH body for a draft: changed fields only, or an error message. */
export function changesFrom(current: Meta, draft: Draft): { changes: DocumentUpdate } | { error: string } {
  const title = draft.title.trim();
  if (!title) return { error: 'The title cannot be empty.' };
  const yearText = draft.year.trim();
  const year = yearText === '' ? null : Number(yearText);
  if (year !== null && (!Number.isInteger(year) || year < -3000 || year > 3000)) {
    return { error: 'The year must be a whole number, such as 2008.' };
  }
  const changes: DocumentUpdate = {};
  if (title !== current.title) changes.title = title;
  const authors = parseList(draft.authors);
  if (authors.join('\u0000') !== current.authors.join('\u0000')) changes.authors = authors;
  if (year !== current.year) changes.year = year;
  const tags = parseList(draft.tags);
  if (tags.join('\u0000') !== current.tags.join('\u0000')) changes.tags = tags;
  return { changes };
}

const toDraft = (meta: Meta): Draft => ({
  title: meta.title,
  authors: meta.authors.join(', '),
  year: meta.year === null ? '' : String(meta.year),
  tags: meta.tags.join(', '),
});

export function DocumentHeader({ slug, initial, facts }: DocumentHeaderProps) {
  const [meta, setMeta] = useState<Meta>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft) return;
    const result = changesFrom(meta, draft);
    if ('error' in result) {
      setProblem({ message: result.error, requestId: null, code: 'invalid', status: 0 });
      return;
    }
    if (Object.keys(result.changes).length === 0) {
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      const updated = await browserApi.patch<DocumentPublic>(`documents/${slug}`, result.changes);
      setMeta({ title: updated.title, authors: updated.authors, year: updated.year, tags: updated.tags });
      setDraft(null);
      setProblem(null);
      toast('Details saved.', 'good');
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      setSaving(false);
    }
  };

  if (draft) {
    const field = (key: keyof Draft) => ({
      value: draft[key],
      onChange: (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value }),
    });
    return (
      <form className={styles.form} onSubmit={save} aria-label="Edit details">
        <label className={styles.wide}>
          <span>Title</span>
          <input {...field('title')} required maxLength={500} autoFocus />
        </label>
        <label className={styles.wide}>
          <span>Authors, separated by commas</span>
          <input {...field('authors')} />
        </label>
        <label>
          <span>Year</span>
          <input {...field('year')} inputMode="numeric" placeholder="None" />
        </label>
        <label>
          <span>Tags, separated by commas</span>
          <input {...field('tags')} />
        </label>
        {problem ? <Problem inline title="The details were not saved." problem={problem} /> : null}
        <div className={styles.buttons}>
          <button type="submit" className={styles.primary} disabled={saving}>
            {saving ? 'Saving…' : 'Save details'}
          </button>
          <button type="button" className={styles.quiet} onClick={() => { setDraft(null); setProblem(null); }}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={styles.header}>
      <p className={styles.facts}>{facts}</p>
      <h1 className={styles.title}>{meta.title}</h1>
      {meta.authors.length > 0 ? <p className={styles.authors}>{meta.authors.join(', ')}</p> : null}
      <div className={styles.row}>
        {meta.year !== null ? <span className={styles.year}>{meta.year}</span> : null}
        {meta.tags.map((tag) => (
          <a key={tag} className={styles.tag} href={`/library?tag=${encodeURIComponent(tag)}`}>
            {tag}
          </a>
        ))}
        <button type="button" className={styles.edit} onClick={() => setDraft(toDraft(meta))}>
          Edit details
        </button>
      </div>
    </div>
  );
}

export default DocumentHeader;

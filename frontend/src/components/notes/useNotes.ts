/**
 * The reader's notes state: the chapter's notes plus the writes on them. Colour
 * changes and deletions apply at once and roll back if the API refuses; creation and
 * adding words to a highlight wait for the server (the note needs its id, the words
 * are for good).
 */
import { useCallback, useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { HighlightColor } from '../../lib/contract';
import { problemOf } from '../common/Problem';
import { toast } from '../document/toast';
import { ApiError } from '../../lib/api/errors';
import { addWords, createNote, deleteNote, getNote, recolorNote, reviewStructured, type NewNote, type NotesApi } from './api';

export function useNotes(initial: NoteDetail[], api: NotesApi = browserApi) {
  const [notes, setNotes] = useState<NoteDetail[]>(initial);
  const [saving, setSaving] = useState(false);

  const fail = (what: string, error: unknown) => {
    const problem = problemOf(error);
    toast(`${what}: ${problem.message}${problem.requestId ? ` (request ${problem.requestId})` : ''}`, 'bad');
  };

  const add = useCallback(
    async (note: NewNote): Promise<NoteDetail | null> => {
      setSaving(true);
      try {
        const created = await createNote(api, note);
        setNotes((list) => [...list, created]);
        toast(created.raw ? 'Saved. A structured version will appear beside it.' : 'Highlighted.', 'good');
        return created;
      } catch (error) {
        fail('The note was not saved', error);
        return null;
      } finally {
        setSaving(false);
      }
    },
    [api],
  );

  const annotate = useCallback(
    async (target: NoteDetail, raw: string): Promise<boolean> => {
      setSaving(true);
      try {
        const updated = await addWords(api, target.id, raw);
        setNotes((list) => list.map((n) => (n.id === target.id ? updated : n)));
        toast('Saved. A structured version will appear beside it.', 'good');
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Words arrived from elsewhere (another tab): show them, they cannot be replaced.
          const current = await getNote(api, target.id).catch(() => null);
          if (current) setNotes((list) => list.map((n) => (n.id === target.id ? current : n)));
          toast('This note already has words, and they are kept as first written.', 'bad');
        } else {
          fail('Your words were not saved', error);
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [api],
  );

  const recolor = useCallback(
    async (target: NoteDetail, color: HighlightColor) => {
      setNotes((list) => list.map((n) => (n.id === target.id ? { ...n, color } : n)));
      try {
        await recolorNote(api, target.id, color);
      } catch (error) {
        setNotes((list) => list.map((n) => (n.id === target.id ? { ...n, color: target.color } : n)));
        fail('The colour was not changed', error);
      }
    },
    [api],
  );

  const remove = useCallback(
    async (target: NoteDetail) => {
      setNotes((list) => list.filter((n) => n.id !== target.id));
      try {
        await deleteNote(api, target.id);
        toast('Note deleted.', 'good');
      } catch (error) {
        setNotes((list) => [...list, target]);
        fail('The note was not deleted', error);
      }
    },
    [api],
  );

  const review = useCallback(
    async (target: NoteDetail, action: 'approve' | 'reject') => {
      const structured = target.structured;
      if (!structured) return;
      const review = action === 'approve' ? 'approved' : 'rejected';
      setNotes((list) =>
        list.map((n) => (n.id === target.id && n.structured ? { ...n, structured: { ...n.structured, review } } : n)),
      );
      try {
        await reviewStructured(api, structured.id, action);
        toast(action === 'approve' ? 'Structured version accepted.' : 'Structured version dismissed. Your note is unchanged.', 'good');
      } catch (error) {
        setNotes((list) => list.map((n) => (n.id === target.id ? target : n)));
        fail('The review was not saved', error);
      }
    },
    [api],
  );

  return { notes, saving, add, annotate, recolor, remove, review };
}

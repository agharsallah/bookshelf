/**
 * The reader's notes state: the chapter's notes plus the writes on them. Colour
 * changes and deletions apply at once and roll back if the API refuses; creation
 * waits for the server so the note has its id.
 */
import { useCallback, useState } from 'react';
import { browserApi } from '../../lib/api/client';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { HighlightColor } from '../../lib/contract';
import { problemOf } from '../document/Problem';
import { toast } from '../document/toast';
import { createNote, deleteNote, recolorNote, reviewStructured, type NewNote, type NotesApi } from './api';

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
        toast(note.range && note.raw ? 'Saved. A structured version will appear beside it.' : 'Saved.', 'good');
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

  return { notes, saving, add, recolor, remove, review };
}

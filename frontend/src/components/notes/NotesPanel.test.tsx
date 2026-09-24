import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NoteDetail } from '../../lib/api/types/notes';
import { groupByUnit, NotesPanel, type NotesScope } from './NotesPanel';

const note = (o: Partial<NoteDetail>): NoteDetail => ({
  id: 'n', document_id: 'd', anchor: 'ch01/p001', range: null, raw: 'words', color: null, target: 'source', artifact_id: null,
  block: null, quote: null, created_at: '2026-01-01T00:00:00Z', structured: null, detached: false, passage: null, ...o,
});

const units = [
  { anchor: 'ch01', heading: 'Stocks' },
  { anchor: 'ch02', heading: 'Flows' },
];

describe('groupByUnit', () => {
  it('groups by chapter in reading order, pane notes first, strays last', () => {
    const groups = groupByUnit(
      [
        note({ id: 'b', anchor: 'ch02/p010' }),
        note({ id: 'a', anchor: 'ch02/p002' }),
        note({ id: 'p', anchor: 'ch02', target: 'chapter_summary', block: 0 }),
        note({ id: 'x', anchor: 'ch09/p001' }),
      ],
      units,
      new Map(),
    );
    expect(groups.map((g) => [g.unit?.anchor ?? null, g.notes.map((n) => n.id)])).toEqual([
      ['ch02', ['p', 'a', 'b']],
      [null, ['x']],
    ]);
  });
});

function Harness({ notes, onReveal = vi.fn() }: { notes: NoteDetail[]; onReveal?: (n: NoteDetail) => void }) {
  const [scope, setScope] = useState<NotesScope>('chapter');
  return (
    <NotesPanel
      notes={notes}
      unit="ch01"
      units={units}
      scope={scope}
      onScope={setScope}
      order={new Map()}
      currentArtifacts={new Set(['a2'])}
      focusedId={null}
      onReveal={onReveal}
      onCite={vi.fn()}
      onColor={vi.fn()}
      onAddWords={vi.fn()}
      onDelete={vi.fn()}
      onReview={vi.fn()}
    />
  );
}

describe('<NotesPanel>', () => {
  const notes = [
    note({ id: 'here', raw: 'in this chapter', passage: 'a queue' }),
    note({ id: 'there', anchor: 'ch02/p001', raw: 'in the next one' }),
    note({ id: 'pane', anchor: 'ch01', raw: 'on the summary', target: 'chapter_summary', artifact_id: 'a1', block: 0, quote: 'gist', passage: 'gist' }),
  ];

  it('shows the chapter by default, and the whole book grouped by chapter on request', async () => {
    render(<Harness notes={notes} />);
    expect(screen.getByText('in this chapter')).toBeTruthy();
    expect(screen.queryByText('in the next one')).toBeNull();
    expect(screen.getByRole('radio', { name: 'This chapter 2' }).getAttribute('aria-checked')).toBe('true');

    await userEvent.click(screen.getByRole('radio', { name: 'Whole book 3' }));

    const flows = screen.getByRole('region', { name: 'Flows' });
    expect(within(flows).getByText('in the next one')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Stocks' })).getByText('in this chapter')).toBeTruthy();
  });

  it('labels pane notes, quotes their words and says when the summary has moved on', async () => {
    const onReveal = vi.fn();
    render(<Harness notes={notes} onReveal={onReveal} />);

    const card = screen.getByRole('article', { name: 'Note on ch01' });
    expect(within(card).getByText('gist')).toBeTruthy();
    expect(within(card).getByText('On an earlier version of the summary.')).toBeTruthy();
    await userEvent.click(within(card).getByRole('button', { name: /^Summary,/ }));
    expect(onReveal).toHaveBeenCalledWith(notes[2]);
  });
});

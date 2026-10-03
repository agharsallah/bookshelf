import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CollectionBoard } from './CollectionBoard';
import type { PathEntry } from './CollectionPath';

const member = (id: string, title: string, read = 0, note: string | null = null): PathEntry => ({
  id,
  slug: id,
  title,
  authors: ['A. Author'],
  genre: 'paper',
  read,
  readLabel: read >= 1 ? 'Finished' : read > 0 ? `${Math.round(read * 100)}% read` : 'Not started',
  finished: false,
  resume: read > 0 && read < 1 ? 'ch-2' : null,
  note,
});

const attention = member('attn', 'Attention', 1, 'The transformer itself.');
const lora = member('lora', 'LoRA', 0.2, 'Adapters are the only weights you may ship.');
const qlora = member('qlora', 'QLoRA');

const play = (members: PathEntry[], next: string | null, handlers: Partial<Parameters<typeof CollectionBoard>[0]> = {}) =>
  render(
    <CollectionBoard collection="gemma" members={members} next={next} onFinished={vi.fn()} onNote={vi.fn(() => Promise.resolve())} {...handlers} />,
  );

const square = (n: number, title: string) => screen.getByRole('button', { name: new RegExp(`^Square ${n}: ${title},`) });

describe('<CollectionBoard>', () => {
  it('lays one square per member in order, saying how far each is read', () => {
    play([attention, lora, qlora], 'lora');

    expect(square(1, 'Attention').getAttribute('data-state')).toBe('done');
    expect(square(2, 'LoRA').getAttribute('data-state')).toBe('here');
    expect(square(3, 'QLoRA').getAttribute('data-state')).toBe('ahead');
    expect(square(2, 'LoRA').getAttribute('aria-label')).toBe('Square 2: LoRA, 20% read');
  });

  it('opens on your move: the member up next, what it adds, and where to keep reading', () => {
    play([attention, lora, qlora], 'lora');

    const card = screen.getByRole('article');
    expect(within(card).getByText('Your move')).toBeTruthy();
    expect(within(card).getByText('Adapters are the only weights you may ship.')).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Keep reading' }).getAttribute('href')).toBe('/documents/lora/read/ch-2?collection=gemma');
    expect(screen.getByText(/Square 2 of 3\. 1 to go/)).toBeTruthy();
  });

  it('shows any square picked, and marks it read from its card', async () => {
    const onFinished = vi.fn();
    play([attention, lora, qlora], 'lora', { onFinished });

    await userEvent.click(square(3, 'QLoRA'));
    const card = screen.getByRole('article');
    expect(within(card).getByRole('heading', { name: 'QLoRA' })).toBeTruthy();
    expect(within(card).queryByText('Your move')).toBeNull();
    expect(square(3, 'QLoRA').getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(within(card).getByRole('button', { name: 'Mark read' }));
    expect(onFinished).toHaveBeenCalledWith(qlora, true);
  });

  it('reads levels from the notes: a legend counting each, and a flag where each begins', () => {
    const iconic = member('swe', 'SWE-bench', 0, 'Iconic: the benchmark itself.');
    play([{ ...attention, note: 'Foundations: the transformer.' }, { ...lora, note: 'Foundations: adapters.' }, iconic], 'lora');

    const legend = within(screen.getByRole('list', { name: 'Levels' }));
    expect(legend.getAllByRole('listitem').map((l) => l.textContent)).toEqual(['1Foundations1/2 read', '2Iconic0/1 read']);
    expect(legend.getByText('Foundations').closest('li')?.hasAttribute('data-here')).toBe(true);
    expect(square(3, 'SWE-bench').getAttribute('aria-label')).toBe('Square 3: SWE-bench, not started, starts Iconic');
    expect(screen.getByText(/in Foundations \(level 1 of 2\)/)).toBeTruthy();
  });

  it('shows no levels when the notes do not name them', () => {
    play([attention, lora, qlora], 'lora');
    expect(screen.queryByRole('list', { name: 'Levels' })).toBeNull();
  });

  it('puts the pawn on the trophy once everything is read', () => {
    play([attention, { ...lora, finished: true }], null);
    expect(screen.getByText(/You made it to the finish: all 2 read/)).toBeTruthy();
  });

  it('draws nothing for an empty collection', () => {
    const { container } = play([], null);
    expect(container.innerHTML).toBe('');
  });

  it('is shown only in the playful tone', () => {
    play([qlora], 'qlora');
    expect(screen.getByRole('region', { name: 'The collection as a board game' }).getAttribute('data-cheer-only')).toBe('playful');
  });
});

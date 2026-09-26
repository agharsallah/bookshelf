// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { marksKey } from './deck';
import { CARDS } from './fixtures';
import { Flashcards } from './Flashcards';

const face = (text: string) => screen.getAllByText(text).map((el) => el.closest('[inert]') === null);
/** True when the card's answer face is the one showing (not inert). */
const answerShowing = () => screen.getByText(/^Future performance/).closest('[inert]') === null;

beforeEach(() => localStorage.clear());

describe('Flashcards', () => {
  it('turns the card to show the cited answer, with a cite into the reader', async () => {
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    expect(answerShowing()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /Turn the card/ }));
    expect(answerShowing()).toBe(true);
    expect(face('What does a behavioral interview evaluate?')).toContain(true);
    expect(screen.getByRole('link', { name: /source ch02\/p006/ }).getAttribute('href')).toBe('/documents/book/read/ch02/p006');
  });

  it('works from the keyboard: Space turns, K marks and moves on, arrows move', () => {
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(screen.getByText('Card 1 of 3')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'K' });
    expect(screen.getByText('Card 2 of 3, 1 known')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByText(/^Card 2 of 3,/)).toBeTruthy();
  });

  it('ends the pass with a tally and studies only the missed cards', async () => {
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    const mark = async (label: RegExp) => {
      await userEvent.click(screen.getByRole('button', { name: /Turn the card/ }));
      await userEvent.click(screen.getByRole('button', { name: label }));
    };
    await mark(/I knew it/);
    await mark(/Still learning/);
    await mark(/I knew it/);
    expect(screen.getByRole('heading', { name: 'End of the deck' })).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Study the one I missed' }));
    expect(screen.getByText('Card 1 of 1')).toBeTruthy();
    expect(screen.getAllByText('What does CARL stand for?').length).toBeGreaterThan(0);
  });

  it('remembers marks per artifact across visits', async () => {
    const { unmount } = render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(JSON.parse(localStorage.getItem(marksKey('a1')) ?? '{}')).toEqual({ 0: 'knew' });
    unmount();
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    expect(await screen.findByText('Card 1 of 3, 1 known')).toBeTruthy();
    expect(screen.getAllByText('You knew this').length).toBeGreaterThan(0);
  });

  it('narrows the deck to one topic', async () => {
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), 'Stories');
    expect(screen.getByText('Card 1 of 2')).toBeTruthy();
    const card = screen.getAllByText('What does CARL stand for?')[0]!;
    expect(within(card.parentElement!).queryByText('What does a behavioral interview evaluate?')).toBeNull();
  });
});

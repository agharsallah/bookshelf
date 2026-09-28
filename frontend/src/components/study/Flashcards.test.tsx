// @vitest-environment happy-dom
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marksKey } from './deck';
import { CARDS } from './fixtures';
import { Flashcards } from './Flashcards';

const face = (text: string) => screen.getAllByText(text).map((el) => el.closest('[inert]') === null);
/** True when the card's answer face is the one showing (not inert). */
const answerShowing = () => screen.getByText(/^Future performance/).closest('[inert]') === null;

/** The review queue, in memory: marks per artifact, as `PUT` left them. */
const server = vi.hoisted(() => ({ marks: {} as Record<string, Record<string, string>> }));
const api = vi.hoisted(() => ({
  get: vi.fn((path: string) => Promise.resolve({ marks: server.marks[path.split('/').pop()!] ?? {} })),
  put: vi.fn((path: string, body: { mark: string }) => {
    const [, , artifact, card] = path.split('/');
    server.marks[artifact!] = { ...server.marks[artifact!], [card!]: body.mark };
    return Promise.resolve({ marks: server.marks[artifact!] });
  }),
  delete: vi.fn((path: string) => {
    server.marks = Object.fromEntries(Object.entries(server.marks).filter(([artifact]) => artifact !== path.split('/').pop()));
    return Promise.resolve(null);
  }),
  post: vi.fn(),
  patch: vi.fn(),
  url: (p: string) => p,
}));
vi.mock('../../lib/api/client', () => ({ browserApi: api }));

beforeEach(() => {
  localStorage.clear();
  server.marks = {};
});

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

  it('keeps marks in the review queue, per artifact, across visits', async () => {
    const { unmount } = render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    fireEvent.keyDown(document.body, { key: ' ' });
    fireEvent.keyDown(document.body, { key: 'k' });
    expect(api.put).toHaveBeenCalledWith('reviews/flashcards/a1/0', { mark: 'knew' });
    expect(localStorage.getItem(marksKey('a1'))).toBeNull();
    unmount();
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    expect(await screen.findByText('Card 1 of 3, 1 known')).toBeTruthy();
    expect(screen.getAllByText('You knew this').length).toBeGreaterThan(0);
  });

  it('moves marks this browser kept to the review queue, once', async () => {
    localStorage.setItem(marksKey('a1'), JSON.stringify({ 1: 'learning' }));
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    expect(await screen.findByText('Card 1 of 3')).toBeTruthy();
    await vi.waitFor(() => expect(server.marks.a1).toEqual({ 1: 'learning' }));
    expect(localStorage.getItem(marksKey('a1'))).toBeNull();
  });

  it('narrows the deck to one topic', async () => {
    render(<Flashcards slug="book" artifactId="a1" cards={CARDS} />);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Topic' }), 'Stories');
    expect(screen.getByText('Card 1 of 2')).toBeTruthy();
    const card = screen.getAllByText('What does CARL stand for?')[0]!;
    expect(within(card.parentElement!).queryByText('What does a behavioral interview evaluate?')).toBeNull();
  });
});

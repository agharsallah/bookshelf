// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { QUESTIONS } from './fixtures';
import { Quiz } from './Quiz';

describe('Quiz', () => {
  it('never shows the answer before you choose, then marks it and explains', async () => {
    render(<Quiz slug="book" questions={QUESTIONS} />);
    expect(screen.queryByText('Correct answer')).toBeNull();
    expect(screen.queryByText(/CARL adds what you learned/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /SOAR/ }));
    expect(screen.getByRole('button', { name: /CARL/ }).textContent).toContain('Correct answer');
    expect(screen.getByRole('button', { name: /SOAR/ }).textContent).toContain('Your answer');
    expect(screen.getByText('Not quite. The answer is 2.')).toBeTruthy();
    expect(screen.getByText(/CARL adds what you learned/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /source ch05\/p003/ }).getAttribute('href')).toBe('/documents/book/read/ch05/p003');
    // A pick is final.
    expect((screen.getByRole('button', { name: /PAR$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('plays by keyboard to a score, reviews the misses and retries them', async () => {
    render(<Quiz slug="book" questions={QUESTIONS} />);
    fireEvent.keyDown(document.body, { key: 'Enter' });
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: '2' });
    expect(screen.getByText('Right.')).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: '9' });
    expect(screen.queryByText(/Not quite/)).toBeNull();
    fireEvent.keyDown(document.body, { key: '1' });
    fireEvent.keyDown(document.body, { key: 'Enter' });

    expect(screen.getByRole('heading', { name: 'Your score' })).toBeTruthy();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    const missed = screen.getByRole('region', { name: 'What you missed' });
    expect(missed.textContent).toContain('Which interviewer type probes for detail?');
    expect(missed.textContent).toContain('The Conversationalist');

    await userEvent.click(screen.getByRole('button', { name: 'Retry the one I missed' }));
    expect(screen.getByText('Question 1 of 1')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Which interviewer type probes for detail?' })).toBeTruthy();
  });

  it('Try again starts every question over', async () => {
    render(<Quiz slug="book" questions={QUESTIONS} />);
    for (const key of ['2', 'Enter', '2', 'Enter']) fireEvent.keyDown(document.body, { key });
    expect(screen.getByText('2 of 2')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
  });
});

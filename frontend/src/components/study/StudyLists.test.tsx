// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { DefinitionBlock, QuoteBlock } from '../../lib/contract';
import { Faq } from './Faq';
import { Glossary } from './Glossary';
import { quoteForClipboard, Quotes } from './Quotes';
import type { FaqItem } from './study-body';

const FAQ: FaqItem[] = [
  { question: 'Why tell stories?', answer: [{ text: 'They show judgment.', cites: ['ch01/p002'] }], group: 'Basics', detail: [] },
  { question: 'How long should a story be?', answer: [{ text: 'About two minutes.', cites: [] }], group: 'Basics', detail: [] },
  { question: 'What about layoffs?', answer: [{ text: 'Say it plainly.', cites: [] }], group: 'Hard cases', detail: [{ type: 'bullets', items: [[{ text: 'Keep it short', cites: [] }]] }] },
];

describe('Faq', () => {
  it('groups questions under their topics, closed until opened', async () => {
    render(<Faq slug="book" items={FAQ} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Basics', 'Hard cases']);
    const question = screen.getByRole('button', { name: 'Why tell stories?' });
    expect(question.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('They show judgment.').closest('[inert]')).not.toBeNull();
    await userEvent.click(question);
    expect(question.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('They show judgment.').closest('[inert]')).toBeNull();
  });

  it('filters as you type, matching answers and detail too', async () => {
    render(<Faq slug="book" items={FAQ} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter the questions' }), 'short');
    expect(screen.getByText('1 of 3 questions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Why tell stories?' })).toBeNull();
    expect(screen.getByRole('button', { name: 'What about layoffs?' })).toBeTruthy();
  });

  it('expands and collapses everything shown', async () => {
    render(<Faq slug="book" items={FAQ} />);
    await userEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByRole('button', { expanded: true })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByRole('button', { expanded: true })).toHaveLength(0);
  });
});

const TERMS: DefinitionBlock[] = [
  { type: 'definition', term: 'STAR', spans: [{ text: 'Situation, task, action, result.', cites: ['ch04/p001'] }] },
  { type: 'definition', term: 'CARL', spans: [{ text: 'Context, action, result, learning.', cites: [] }] },
  { type: 'definition', term: 'Callback', spans: [{ text: 'A second interview.', cites: [] }] },
];

describe('Glossary', () => {
  it('files terms by letter and disables letters without terms', () => {
    render(<Glossary slug="book" terms={TERMS} />);
    const index = screen.getByRole('navigation', { name: 'Jump to a letter' });
    expect(index.querySelectorAll('a')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'C' }).getAttribute('href')).toBe('#glossary-c');
    expect(screen.getByText('B').getAttribute('aria-disabled')).toBe('true');
    expect([...document.querySelectorAll('dfn')].map((d) => d.textContent)).toEqual(['Callback', 'CARL', 'STAR']);
  });

  it('filters terms and their letters', async () => {
    render(<Glossary slug="book" terms={TERMS} />);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter the terms' }), 'situation');
    expect([...document.querySelectorAll('dfn')].map((d) => d.textContent)).toEqual(['STAR']);
    expect(screen.getByText('C').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('Quotes', () => {
  const quote: QuoteBlock = { type: 'quote', text: 'Stories are data with a soul.', attribution: 'The author', cites: ['ch03/p010'], page: 42 };

  it('copies the quote with who said it and where, and confirms', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<Quotes slug="book" bookTitle="The Book" quotes={[quote]} />);
    expect(screen.getByRole('link', { name: /source ch03\/p010/ }).getAttribute('href')).toBe('/documents/book/read/ch03/p010');
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('“Stories are data with a soul.” — The author, The Book, p. 42');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
  });

  it('falls back to the book as the source', () => {
    expect(quoteForClipboard({ ...quote, attribution: undefined, page: null } as QuoteBlock, 'The Book')).toBe('“Stories are data with a soul.” — The Book');
  });
});

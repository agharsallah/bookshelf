import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CiteProvider } from '../blocks/CiteContext';
import { NotationTable } from './NotationTable';
import { TryIt } from './TryIt';

const span = (text: string) => ({ text, cites: ['ch03/s01/m001'] });

describe('<TryIt>', () => {
  it('keeps the answer hidden until asked, and hides it again', async () => {
    render(<TryIt question={[span('What is 1 + 1?')]} answer={[span('1 + 1 = 2.')]} />);
    const button = screen.getByRole('button', { name: 'Show the answer' });
    const answer = screen.getByText('1 + 1 = 2.').closest('p');

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(answer?.hidden).toBe(true);
    expect(button.getAttribute('aria-controls')).toBe(answer?.id);

    await userEvent.click(button);
    expect(answer?.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Hide the answer' }));
    expect(answer?.hidden).toBe(true);
  });

  it('offers no button without an answer, and nothing without a question', () => {
    const { container, rerender } = render(<TryIt question={[span('Think about it.')]} answer={[]} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TryIt question={[]} answer={[span('x')]} />);
    expect(container.textContent).toBe('');
  });
});

describe('<NotationTable> explain links', () => {
  it('links a symbol used in a formula to that formula on the math tab', () => {
    const symbols = [
      { latex: 'g_i', meaning: 'Gate score.', firstAnchor: 'ch03/s01/m001', cites: ['ch03/s01/m001'], html: '<i>g</i>' },
      { latex: 'q', meaning: 'Question.', firstAnchor: 'ch03/s01/p001', cites: ['ch03/s01/p001'], html: '<i>q</i>' },
    ];
    render(
      <CiteProvider value={{ onCite: () => undefined, citeHref: (a) => `/read/${a}` }}>
        <NotationTable symbols={symbols} searchable={false} explainHref={(f) => `/math#${f}`} />
      </CiteProvider>,
    );
    const links = screen.getAllByRole('link', { name: 'Explain this math' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/math#ch03/s01/m001']);
  });
});

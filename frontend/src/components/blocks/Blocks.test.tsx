import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RenderBlock } from '../../lib/contract';
import type * as MermaidModule from '../../lib/mermaid';
import { Blocks } from './Blocks';
import { needsSeparator } from './Spans';

// Own adapters around heavy third-party renderers: keep the DOM suite fast and
// deterministic. Their real behaviour is covered by lib/*.test.ts in Node.
vi.mock('../../lib/mermaid', async (importOriginal) => ({
  ...(await importOriginal<typeof MermaidModule>()),
  renderDiagram: () => Promise.resolve('<svg data-testid="mermaid-svg"></svg>'),
}));
vi.mock('../../lib/highlight', () => ({
  highlightCode: () => Promise.resolve('<pre class="shiki"><code>highlighted</code></pre>'),
}));

function renderOne(block: RenderBlock) {
  return render(<Blocks blocks={[block]} />);
}

describe('<Blocks> renders each block type', () => {
  it('heading at its level', () => {
    renderOne({ type: 'heading', level: 3, text: 'Leverage points' });
    expect(screen.getByRole('heading', { level: 3, name: 'Leverage points' })).toBeTruthy();
  });

  it('paragraph with marks', () => {
    const { container } = renderOne({
      type: 'paragraph',
      spans: [
        { text: 'Rules', mark: 'strong', cites: [] },
        { text: 'outrank', mark: 'em', cites: [] },
        { text: 'parameters', mark: 'highlight', cites: [] },
        { text: 'x += 1', mark: 'code', cites: [] },
      ],
    });
    const p = container.querySelector('p');
    expect(p?.textContent).toBe('Rules outrank parameters x += 1');
    expect(['strong', 'em', 'mark', 'code'].map((tag) => p?.querySelector(tag)?.textContent)).toEqual([
      'Rules',
      'outrank',
      'parameters',
      'x += 1',
    ]);
  });

  it('bullets as an unordered list and steps as an ordered list', () => {
    render(
      <Blocks
        blocks={[
          { type: 'bullets', items: [[{ text: 'Stocks', cites: [] }], [{ text: 'Flows', cites: [] }]] },
          { type: 'steps', items: [[{ text: 'Name the stock', cites: [] }], [{ text: 'Find the delay', cites: [] }]] },
        ]}
      />,
    );
    const [ul, ol] = screen.getAllByRole('list');
    expect(ul?.tagName).toBe('UL');
    expect(within(ul!).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Stocks', 'Flows']);
    expect(ol?.tagName).toBe('OL');
    expect(within(ol!).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Name the stock', 'Find the delay']);
  });

  it('table with caption, column headers and span cells', () => {
    renderOne({
      type: 'table',
      caption: 'Places to intervene',
      header: ['Point', 'Rank'],
      rows: [[{ text: 'Paradigms', cites: [] }, { text: '2', cites: [] }]],
    });
    const table = screen.getByRole('table', { name: 'Places to intervene' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Point', 'Rank']);
    expect(within(table).getByRole('rowheader').textContent).toBe('Paradigms');
    expect(within(table).getByRole('cell').textContent).toBe('2');
  });

  it('chart as a labelled image with a data table of every value', () => {
    renderOne({
      type: 'chart',
      kind: 'bar',
      title: 'Effect by point',
      x: { label: 'Point', values: ['Rules', 'Goals'] },
      series: [{ name: 'Effect', values: [3.1, null] }],
      cites: [],
    });
    expect(screen.getByRole('img', { name: /Effect by point\. bar chart of Effect by Point/ })).toBeTruthy();
    const rows = within(screen.getByRole('table', { name: 'Effect by point' })).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual(['PointEffect', 'Rules3.1', 'Goals—']);
    expect(document.querySelectorAll('path[d^="M"]')).toHaveLength(1);
  });

  it('diagram as a text version, then the Mermaid drawing once rendered', async () => {
    const { container } = renderOne({
      type: 'diagram',
      nodes: [
        { id: 'births', label: 'Births' },
        { id: 'pop', label: 'Population' },
      ],
      edges: [{ from: 'births', to: 'pop', label: 'adds' }],
      cites: [],
    });
    expect(screen.getByRole('listitem').textContent).toContain('Births adds → ');
    await waitFor(() => expect(container.querySelector('[data-testid="mermaid-svg"]')).toBeTruthy());
    expect(container.querySelector('figure')?.hasAttribute('data-rendered')).toBe(true);
  });

  it.each([
    ['important', 'Important'],
    ['remember', 'Remember'],
    ['antipattern', 'Antipattern'],
    ['insight', 'Insight'],
    ['caution', 'Caution'],
    ['contrast', 'Contrast'],
    ['question', 'Question'],
  ] as const)('callout with tone %s, labelled %s', (tone, label) => {
    renderOne({ type: 'callout', tone, title: 'Delays', spans: [{ text: 'Correct slowly.', cites: [] }] });
    const note = screen.getByRole('complementary', { name: `${label}: Delays` });
    expect(note.dataset.tone).toBe(tone);
    expect(note.textContent).toContain('Correct slowly.');
  });

  it('code: pre-rendered HTML when prepared', () => {
    render(
      <Blocks
        blocks={[{ type: 'code', language: 'python', text: 'x = 1', html: '<pre class="shiki">prepared</pre>', cites: [] }]}
      />,
    );
    expect(document.querySelector('pre.shiki')?.textContent).toBe('prepared');
  });

  it('code: plain source first, highlighted lazily when not prepared', async () => {
    renderOne({ type: 'code', language: 'python', text: 'x = 1', caption: 'Assignment', cites: [] });
    expect(screen.getByText('x = 1').tagName).toBe('CODE');
    expect(screen.getByText('Assignment')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('pre.shiki')?.textContent).toBe('highlighted'));
  });

  it('math: KaTeX output and the meaning in words', async () => {
    renderOne({
      type: 'math',
      latex: 'S = \\int f',
      meaning: [{ text: 'A stock integrates its net flow.', cites: [] }],
      cites: [],
    });
    expect(screen.getByText('A stock integrates its net flow.')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.katex')).toBeTruthy());
  });

  it('quote with attribution and page', () => {
    renderOne({ type: 'quote', text: 'Understand “and.”', attribution: 'Sufi story', cites: [], page: 12 });
    const figure = screen.getByRole('figure');
    expect(within(figure).getByText('Understand “and.”').closest('blockquote')).toBeTruthy();
    expect(figure.textContent).toContain('Sufi story');
    expect(figure.textContent).toContain('p. 12');
  });

  it('definition as a term and its explanation', () => {
    renderOne({ type: 'definition', term: 'stock', spans: [{ text: 'An accumulation.', cites: [] }] });
    expect(screen.getByText('stock').closest('dt')?.querySelector('dfn')?.textContent).toBe('stock');
    expect(screen.getByRole('definition').textContent).toBe('An accumulation.');
  });
});

describe('cite chips', () => {
  const cited: RenderBlock = {
    type: 'paragraph',
    spans: [{ text: 'Rules outrank parameters.', cites: ['ch06/s01/p003', 'ch06/s02/p011'] }],
  };

  it('link to the anchor fragment by default and show a compact label', () => {
    render(<Blocks blocks={[cited]} />);
    const chip = screen.getByRole('link', { name: 'Source ch06/s01/p003' });
    expect(chip.getAttribute('href')).toBe('#ch06/s01/p003');
    expect(chip.textContent).toContain('6.1 ¶3');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('use citeHref to build the link', () => {
    render(<Blocks blocks={[cited]} citeHref={(a) => `/read/meadows#${a}`} />);
    expect(screen.getByRole('link', { name: 'Source ch06/s02/p011' }).getAttribute('href')).toBe(
      '/read/meadows#ch06/s02/p011',
    );
  });

  it('use citeLabel and citeTitle for the chip text and its accessible name', () => {
    render(
      <Blocks
        blocks={[cited]}
        citeLabel={(a) => `A ${a.slice(-3)}`}
        citeTitle={(a) => `Thinking in Systems, ${a}`}
      />,
    );
    const chip = screen.getByRole('link', { name: 'Source Thinking in Systems, ch06/s02/p011' });
    expect(chip.textContent).toContain('A 011');
  });

  it('call onCite with the anchor instead of navigating', async () => {
    const onCite = vi.fn();
    render(<Blocks blocks={[cited]} onCite={onCite} />);
    const chip = screen.getByRole('link', { name: 'Source ch06/s02/p011' });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    chip.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    await userEvent.click(screen.getByRole('link', { name: 'Source ch06/s01/p003' }));
    expect(onCite.mock.calls).toEqual([['ch06/s02/p011'], ['ch06/s01/p003']]);
  });

  it('list block-level sources on figures', () => {
    renderOne({ type: 'quote', text: 'q', cites: ['ch01/s01/p001'], page: null });
    expect(screen.getByText('Source')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Source ch01/s01/p001' })).toBeTruthy();
  });
});

describe('robustness', () => {
  it('renders a visible notice for an unknown block type and keeps rendering the rest', () => {
    const blocks = [
      { type: 'hologram', data: 1 },
      { type: 'heading', level: 2, text: 'Still here' },
    ] as unknown as RenderBlock[];
    render(<Blocks blocks={blocks} />);
    expect(screen.getByRole('note').textContent).toContain('Unsupported block “hologram”');
    expect(screen.getByRole('heading', { name: 'Still here' })).toBeTruthy();
  });
});

describe('needsSeparator', () => {
  it.each([
    ['word', 'next', true],
    ['word ', 'next', false],
    ['word', ' next', false],
    ['word', '.', false],
    ['word', ', and', false],
  ])('between %j and %j is %s', (previous, next, expected) => {
    expect(needsSeparator(previous, next)).toBe(expected);
  });
});

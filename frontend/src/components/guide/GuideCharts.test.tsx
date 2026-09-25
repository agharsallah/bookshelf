import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChapterJourney } from './ChapterJourney';
import { NumberTiles } from './NumberTiles';
import { ThemeHeatmap } from './ThemeHeatmap';
import { chapterRows, type Unit } from './guide';

const citeHref = (anchor: string) => `/documents/okafor/read/${anchor}`;
const unit = (anchor: string, heading: string, words: number): Unit => ({ anchor, heading, words, frontMatter: false });
const rows = chapterRows(
  [unit('ch01', 'Why work waits', 2380), unit('ch02', "Little's law", 4760), unit('ch03', 'Slack', 1190)],
  [
    { anchor: 'ch01', role: 'setup', takeaway: [{ text: 'Waiting dominates.', cites: ['ch01/p002'] }] },
    { anchor: 'ch02', role: 'concept', takeaway: [] },
  ],
);

describe('ChapterJourney', () => {
  it('draws one arc segment and one row per chapter, linked into the reader', () => {
    render(<ChapterJourney rows={rows} citeHref={citeHref} />);
    const segment = screen.getByRole('link', { name: "Chapter 2, Little's law: Core idea, 20 min" });
    expect(segment.getAttribute('href')).toBe('/documents/okafor/read/ch02');
    expect(screen.getByRole('link', { name: 'Why work waits' }).getAttribute('href')).toBe('/documents/okafor/read/ch01');
    expect(screen.getAllByRole('listitem').filter((li) => li.closest('ol'))).toHaveLength(3);
    expect(screen.getByText('Waiting dominates.')).toBeTruthy();
  });

  it('names every role in the legend with its count, including chapters without one', () => {
    render(<ChapterJourney rows={rows} citeHref={citeHref} />);
    const legend = screen.getByRole('list', { name: 'Chapter roles' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sets up 1', 'Core idea 1', 'Not described 1']);
  });
});

describe('ThemeHeatmap', () => {
  it('is a table of theme × chapter whose filled cells open the first cited passage', () => {
    render(
      <ThemeHeatmap
        themes={[{ name: 'Flow', spans: [{ text: 'Returns.', cites: ['ch01/p002', 'ch03/s01/p004', 'ch03/p009'] }] }]}
        rows={rows}
        citeHref={citeHref}
      />,
    );
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Theme', '1', '2', '3', 'Chapters']);
    const cell = within(table).getByRole('link', { name: 'Flow in chapter 3, Slack: 2 passages' });
    expect(cell.getAttribute('href')).toBe('/documents/okafor/read/ch03/s01/p004');
    expect(within(table).getByRole('img', { name: "Not in chapter 2, Little's law" })).toBeTruthy();
    expect(within(table).getByRole('row', { name: /Flow/ }).lastElementChild?.textContent).toBe('2');
  });
});

describe('NumberTiles', () => {
  it('shows each value over its cited label', () => {
    render(<NumberTiles tiles={[{ value: '~80%', label: [{ text: 'Utilization threshold', cites: ['ch03/p004'] }] }]} citeHref={citeHref} label="Numbers" />);
    const tile = within(screen.getByRole('list', { name: 'Numbers' })).getByRole('listitem');
    expect(tile.textContent).toContain('~80%');
    expect(within(tile).getByRole('link').getAttribute('href')).toBe('/documents/okafor/read/ch03/p004');
  });
});

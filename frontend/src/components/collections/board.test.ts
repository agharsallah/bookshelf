import { describe, expect, it } from 'vitest';
import { boardFor, levelAt, levelOf, levelsOf, spiral, trackPoints, type BoardCell } from './board';

const adjacent = (a: BoardCell, b: BoardCell) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

describe('spiral', () => {
  it('winds clockwise from the top-left corner, leaving a blank row between rings', () => {
    const track = spiral(5, 5);
    expect(track.slice(0, 5)).toEqual([0, 1, 2, 3, 4].map((col) => ({ row: 0, col })));
    expect(track.slice(5, 9).map((c) => c.col)).toEqual([4, 4, 4, 4]);
    // Up the left side it turns short of the top row, so rings never touch.
    expect(track).not.toContainEqual({ row: 1, col: 0 });
    expect(track.at(-1)).toEqual({ row: 2, col: 2 });
  });

  it('is one unbroken path that never revisits a cell', () => {
    const track = spiral(13, 7);
    expect(new Set(track.map((c) => `${c.row},${c.col}`)).size).toBe(track.length);
    track.slice(1).forEach((cell, i) => expect(adjacent(track[i] as BoardCell, cell)).toBe(true));
  });
});

describe('boardFor', () => {
  it.each([1, 3, 8, 14, 30, 48, 120])('holds exactly %i squares, inside its trimmed grid', (squares) => {
    const { cols, rows, cells } = boardFor(squares);
    expect(cells).toHaveLength(squares);
    expect(Math.max(...cells.map((c) => c.col))).toBe(cols - 1);
    expect(Math.max(...cells.map((c) => c.row))).toBe(rows - 1);
    expect(Math.min(...cells.map((c) => c.row))).toBe(0);
    expect(Math.min(...cells.map((c) => c.col))).toBe(0);
  });

  it('starts on the outer edge, ends inside the innermost ring, and is wider than tall', () => {
    const { cols, rows, cells } = boardFor(48);
    expect(cols).toBeGreaterThan(rows);
    const [start, finish] = [cells[0] as BoardCell, cells.at(-1) as BoardCell];
    expect(start.row === rows - 1 || start.row === 0 || start.col === 0 || start.col === cols - 1).toBe(true);
    expect(finish.row).toBeGreaterThan(0);
    expect(finish.row).toBeLessThan(rows - 1);
    expect(finish.col).toBeGreaterThan(0);
    expect(finish.col).toBeLessThan(cols - 1);
  });

  it('is empty with nothing to place', () => {
    expect(boardFor(0)).toEqual({ cols: 0, rows: 0, cells: [] });
  });
});

it('traces the squares through their centres', () => {
  expect(
    trackPoints([
      { row: 0, col: 0 },
      { row: 0, col: 1 },
      { row: 1, col: 1 },
    ]),
  ).toBe('0.5,0.5 1.5,0.5 1.5,1.5');
});

describe('levels', () => {
  it('reads a short label before the colon, not the start of a sentence', () => {
    expect(levelOf('Foundations: the transformer itself.')).toBe('Foundations');
    expect(levelOf('New: a survey.')).toBe('New');
    expect(levelOf('This one matters because: reasons')).toBeNull();
    expect(levelOf('No label here')).toBeNull();
    expect(levelOf(null)).toBeNull();
  });

  it('groups consecutive members by level, counting what is read', () => {
    const levels = levelsOf([
      { note: 'Foundations: a', done: true },
      { note: 'foundations: b', done: false },
      { note: 'Iconic: c', done: false },
    ]);
    expect(levels).toEqual([
      { name: 'Foundations', first: 0, count: 2, done: 1 },
      { name: 'Iconic', first: 2, count: 1, done: 0 },
    ]);
    expect(levelAt(levels, 1)).toBe(0);
    expect(levelAt(levels, 2)).toBe(1);
  });

  it('shows no levels unless every member names one and there are two or more', () => {
    expect(
      levelsOf([
        { note: 'Foundations: a', done: false },
        { note: null, done: false },
      ]),
    ).toEqual([]);
    expect(
      levelsOf([
        { note: 'Foundations: a', done: false },
        { note: 'Foundations: b', done: false },
      ]),
    ).toEqual([]);
  });
});

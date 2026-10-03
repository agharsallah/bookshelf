/**
 * The playful reading path as a game board: a spiral track that winds clockwise from the
 * outer edge to the middle, with a blank row between its rings so the way on is always
 * plain. Start is the first square, each member one square in reading order, and the
 * finish sits at the heart of the spiral. Pure geometry, so it is tested on its own.
 */

export interface BoardCell {
  row: number;
  col: number;
}

export interface Board {
  cols: number;
  rows: number;
  /** One cell per square, in the order they are played. */
  cells: BoardCell[];
}

const TURN_RIGHT: Record<string, [number, number]> = {
  '0,1': [1, 0],
  '1,0': [0, -1],
  '0,-1': [-1, 0],
  '-1,0': [0, 1],
};

/**
 * The whole track on a `cols` × `rows` grid, from the top-left corner clockwise inward.
 * It turns when the way ahead leaves the grid or would run alongside a ring already laid.
 */
export function spiral(cols: number, rows: number): BoardCell[] {
  if (cols < 1 || rows < 1) return [];
  const laid = new Set<string>();
  const key = (r: number, c: number) => `${r},${c}`;
  const open = (r: number, c: number) => r >= 0 && r < rows && c >= 0 && c < cols && !laid.has(key(r, c));
  const free = (r: number, c: number, dr: number, dc: number) => open(r + dr, c + dc) && !laid.has(key(r + 2 * dr, c + 2 * dc));

  const cells: BoardCell[] = [];
  let [row, col, dr, dc] = [0, 0, 0, 1];
  for (;;) {
    cells.push({ row, col });
    laid.add(key(row, col));
    if (!free(row, col, dr, dc)) {
      [dr, dc] = TURN_RIGHT[`${dr},${dc}`] ?? [0, 1];
      if (!free(row, col, dr, dc)) return cells;
    }
    row += dr;
    col += dc;
  }
}

/** A board about half again as wide as it is tall: wide screens, few rows to scan. */
const colsFor = (rows: number) => Math.max(rows, Math.round(rows * 1.6) | 1);

/**
 * The smallest board whose spiral holds `squares` squares, using its innermost stretch so
 * the last square (the finish) is always at the middle, trimmed to the squares it uses.
 */
export function boardFor(squares: number): Board {
  if (squares <= 0) return { cols: 0, rows: 0, cells: [] };
  for (let rows = 1; ; rows += 2) {
    const cols = colsFor(rows);
    const track = spiral(cols, rows);
    if (track.length >= squares) return cropped(track.slice(track.length - squares));
  }
}

/** The board trimmed to the rows and columns its squares use. */
function cropped(cells: BoardCell[]): Board {
  const top = Math.min(...cells.map((c) => c.row));
  const left = Math.min(...cells.map((c) => c.col));
  const moved = cells.map((c) => ({ row: c.row - top, col: c.col - left }));
  return {
    cols: Math.max(...moved.map((c) => c.col)) + 1,
    rows: Math.max(...moved.map((c) => c.row)) + 1,
    cells: moved,
  };
}

/** Points for an SVG polyline through the squares' centres, in grid units. */
export function trackPoints(cells: readonly BoardCell[]): string {
  return cells.map((c) => `${c.col + 0.5},${c.row + 0.5}`).join(' ');
}

/** A stretch of the path, read from the members' notes ("Foundations: why it is here"). */
export interface Level {
  name: string;
  /** 0-based index of its first member. */
  first: number;
  count: number;
  done: number;
}

/** The level a note names before its colon: a short label, not the start of a sentence. */
export function levelOf(note: string | null | undefined): string | null {
  const match = /^\s*([^:\n]{1,24}):\s+\S/.exec(note ?? '');
  const name = match?.[1]?.trim();
  return name && name.split(/\s+/).length <= 3 ? name : null;
}

/**
 * The path cut into levels: runs of consecutive members whose notes name the same level.
 * Only worth showing when every member names one and there are at least two; otherwise
 * none, and the board falls back to the genres.
 */
export function levelsOf(members: readonly { note: string | null; done: boolean }[]): Level[] {
  const levels: Level[] = [];
  for (const [i, m] of members.entries()) {
    const name = levelOf(m.note);
    if (!name) return [];
    const last = levels.at(-1);
    if (last?.name.toLowerCase() === name.toLowerCase()) {
      last.count += 1;
      last.done += m.done ? 1 : 0;
    } else levels.push({ name, first: i, count: 1, done: m.done ? 1 : 0 });
  }
  return levels.length >= 2 ? levels : [];
}

/** The 0-based level a member at `index` belongs to, or -1. */
export const levelAt = (levels: readonly Level[], index: number): number => levels.findIndex((l) => index >= l.first && index < l.first + l.count);

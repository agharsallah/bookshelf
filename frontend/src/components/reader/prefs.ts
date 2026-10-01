/**
 * Reader preferences: how the text is set (font, size, leading, paragraph spacing,
 * measure, alignment, page margins), which panes are shown, and the reading aids (focus mode,
 * colour-coded passages, what-matters marks, spotlight). One JSON object in localStorage, validated
 * field by field on the way in so a stale or hand-edited value never breaks the page.
 */

export const FONTS = ['book', 'classic', 'sans'] as const;
export const LEADINGS = ['tight', 'normal', 'loose', 'airy'] as const;
export const SPACINGS = ['compact', 'normal', 'roomy'] as const;
export const WIDTHS = ['narrow', 'normal', 'wide'] as const;
export const ALIGNS = ['start', 'justify'] as const;
export const MARGINS = ['normal', 'narrow'] as const;

export type ReaderFont = (typeof FONTS)[number];
export type Leading = (typeof LEADINGS)[number];
export type Spacing = (typeof SPACINGS)[number];
export type Width = (typeof WIDTHS)[number];
export type Align = (typeof ALIGNS)[number];
export type Margins = (typeof MARGINS)[number];

/** Text sizes in rem, smallest first; `size` is an index into this. */
export const SIZES = [0.9375, 1, 1.0625, 1.125, 1.25, 1.375, 1.5] as const;

export interface ReaderPrefs {
  font: ReaderFont;
  size: number;
  leading: Leading;
  spacing: Spacing;
  width: Width;
  align: Align;
  /** How far the reader's frame may spread on a large screen: `narrow` leaves thin side margins. */
  margins: Margins;
  /** A dragged text width in px, used while a side pane is shown; null: the `width` preset. */
  measure: number | null;
  /** The dragged width of the passage drawer (the book guide's cites), px; null: its default. */
  passage: number | null;
  /** The contents rail on the left (wide screens). */
  contents: boolean;
  /** The distillation pane on the right. */
  pane: boolean;
  /** Site chrome and both panes out of the way; the toolbar hides while you read. */
  focus: boolean;
  /** Quotes, examples, exercises, warnings… tinted and labelled by what they are. */
  semantic: boolean;
  /** Core ideas, key points and terms marked in the text, drawn in as you read. */
  salience: boolean;
  /** Dim every block but the one being read. */
  spotlight: boolean;
  /** Before an unread chapter, guess what it argues from its headings. */
  predict: boolean;
  /** The chapters that follow are added below as you reach the end, so the book reads in one scroll. */
  continuous: boolean;
  /** Papers read in three-pass mode: document id → the pass on (absent: the mode is off). */
  paperPasses: Readonly<Record<string, 1 | 2 | 3>>;
}

export const DEFAULT_PREFS: Readonly<ReaderPrefs> = Object.freeze({
  font: 'book',
  size: 3,
  leading: 'normal',
  spacing: 'normal',
  width: 'normal',
  align: 'start',
  margins: 'normal',
  measure: null,
  passage: null,
  contents: true,
  pane: true,
  focus: false,
  semantic: false,
  salience: false,
  spotlight: false,
  predict: true,
  continuous: false,
  paperPasses: Object.freeze({}),
});

/** At most this many papers remember their pass; the oldest entries go first. */
export const MAX_PAPER_PASSES = 200;

export const PREFS_STORAGE_KEY = 'bookshelf:reader';

const FONT_STACKS: Record<ReaderFont, string> = {
  book: 'var(--font-read)',
  classic: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
  sans: 'var(--font-ui)',
};
const LEADING_VALUES: Record<Leading, string> = { tight: '1.45', normal: '1.62', loose: '1.8', airy: '2' };
const SPACING_VALUES: Record<Spacing, string> = { compact: '0.5em', normal: '0.9em', roomy: '1.5em' };
/** The text column in rem, block gutters included. */
export const WIDTH_REM: Record<Width, number> = { narrow: 34, normal: 40, wide: 48 };
/** The widest the reader's frame gets; `narrow` lets it run to the screen's edge gutters. */
const FRAME_VALUES: Record<Margins, string> = { normal: '92rem', narrow: '100vw' };

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** A stored dragged width, if it is a sane number of px. */
function measure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 240 && value <= 4000 ? Math.round(value) : null;
}

export function clampSize(size: number): number {
  return Math.min(SIZES.length - 1, Math.max(0, Math.round(size)));
}

/** A stored document id → pass map, keeping only sane entries (and the newest `MAX_PAPER_PASSES`). */
function paperPasses(value: unknown): Record<string, 1 | 2 | 3> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, 1 | 2 | 3] => entry[1] === 1 || entry[1] === 2 || entry[1] === 3,
  );
  return Object.fromEntries(entries.slice(-MAX_PAPER_PASSES));
}

/** Stored JSON → preferences; anything missing or invalid takes its default. */
export function parsePrefs(raw: string | null): ReaderPrefs {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
  } catch {
    // Unreadable: start from the defaults.
  }
  const d = DEFAULT_PREFS;
  return {
    font: oneOf(FONTS, data.font, d.font),
    size: typeof data.size === 'number' && Number.isFinite(data.size) ? clampSize(data.size) : d.size,
    leading: oneOf(LEADINGS, data.leading, d.leading),
    spacing: oneOf(SPACINGS, data.spacing, d.spacing),
    width: oneOf(WIDTHS, data.width, d.width),
    align: oneOf(ALIGNS, data.align, d.align),
    margins: oneOf(MARGINS, data.margins, d.margins),
    measure: measure(data.measure),
    passage: measure(data.passage),
    contents: flag(data.contents, d.contents),
    pane: flag(data.pane, d.pane),
    focus: flag(data.focus, d.focus),
    semantic: flag(data.semantic, d.semantic),
    salience: flag(data.salience, d.salience),
    spotlight: flag(data.spotlight, d.spotlight),
    predict: flag(data.predict, d.predict),
    continuous: flag(data.continuous, d.continuous),
    paperPasses: paperPasses(data.paperPasses),
  };
}

/** True when the typography matches the defaults (panes and aids aside). */
export function isDefaultType(prefs: ReaderPrefs): boolean {
  const d = DEFAULT_PREFS;
  return (
    prefs.font === d.font &&
    prefs.size === d.size &&
    prefs.leading === d.leading &&
    prefs.spacing === d.spacing &&
    prefs.width === d.width &&
    prefs.align === d.align &&
    prefs.margins === d.margins &&
    prefs.measure === d.measure
  );
}

/**
 * The typography as custom properties for the reader root. `dragged`: the layout
 * lets a dragged width replace the preset (a side pane shown).
 */
export function prefsVars(prefs: ReaderPrefs, dragged = false): Record<string, string> {
  return {
    '--reader-font': FONT_STACKS[prefs.font],
    '--reader-size': `${SIZES[clampSize(prefs.size)]}rem`,
    '--reader-leading': LEADING_VALUES[prefs.leading],
    '--reader-gap': SPACING_VALUES[prefs.spacing],
    '--reader-measure': dragged && prefs.measure !== null ? `${prefs.measure}px` : `${WIDTH_REM[prefs.width]}rem`,
    '--reader-align': prefs.align,
    '--reader-frame': FRAME_VALUES[prefs.margins],
  };
}

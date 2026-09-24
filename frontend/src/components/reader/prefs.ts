/**
 * Reader preferences: how the text is set (font, size, leading, paragraph spacing,
 * measure, alignment), which panes are shown, and the reading aids (focus mode,
 * colour-coded passages, spotlight). One JSON object in localStorage, validated
 * field by field on the way in so a stale or hand-edited value never breaks the page.
 */

export const FONTS = ['book', 'classic', 'sans'] as const;
export const LEADINGS = ['tight', 'normal', 'loose', 'airy'] as const;
export const SPACINGS = ['compact', 'normal', 'roomy'] as const;
export const WIDTHS = ['narrow', 'normal', 'wide'] as const;
export const ALIGNS = ['start', 'justify'] as const;

export type ReaderFont = (typeof FONTS)[number];
export type Leading = (typeof LEADINGS)[number];
export type Spacing = (typeof SPACINGS)[number];
export type Width = (typeof WIDTHS)[number];
export type Align = (typeof ALIGNS)[number];

/** Text sizes in rem, smallest first; `size` is an index into this. */
export const SIZES = [0.9375, 1, 1.0625, 1.125, 1.25, 1.375, 1.5] as const;

export interface ReaderPrefs {
  font: ReaderFont;
  size: number;
  leading: Leading;
  spacing: Spacing;
  width: Width;
  align: Align;
  /** A dragged text width in px, used while exactly one side pane is shown; null: the `width` preset. */
  measure: number | null;
  /** The contents rail on the left (wide screens). */
  contents: boolean;
  /** The distillation pane on the right. */
  pane: boolean;
  /** Site chrome and both panes out of the way; the toolbar hides while you read. */
  focus: boolean;
  /** Quotes, examples, exercises, warnings… tinted and labelled by what they are. */
  semantic: boolean;
  /** Dim every block but the one being read. */
  spotlight: boolean;
}

export const DEFAULT_PREFS: Readonly<ReaderPrefs> = Object.freeze({
  font: 'book',
  size: 3,
  leading: 'normal',
  spacing: 'normal',
  width: 'normal',
  align: 'start',
  measure: null,
  contents: true,
  pane: true,
  focus: false,
  semantic: false,
  spotlight: false,
});

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
    measure: measure(data.measure),
    contents: flag(data.contents, d.contents),
    pane: flag(data.pane, d.pane),
    focus: flag(data.focus, d.focus),
    semantic: flag(data.semantic, d.semantic),
    spotlight: flag(data.spotlight, d.spotlight),
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
    prefs.measure === d.measure
  );
}

/**
 * The typography as custom properties for the reader root. `dragged`: the layout
 * lets a dragged width replace the preset (one side pane shown).
 */
export function prefsVars(prefs: ReaderPrefs, dragged = false): Record<string, string> {
  return {
    '--reader-font': FONT_STACKS[prefs.font],
    '--reader-size': `${SIZES[clampSize(prefs.size)]}rem`,
    '--reader-leading': LEADING_VALUES[prefs.leading],
    '--reader-gap': SPACING_VALUES[prefs.spacing],
    '--reader-measure': dragged && prefs.measure !== null ? `${prefs.measure}px` : `${WIDTH_REM[prefs.width]}rem`,
    '--reader-align': prefs.align,
  };
}

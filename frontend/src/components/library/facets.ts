/**
 * The shelf's colour code. Every book sits in one bucket of each dimension: its kind
 * (book, paper, article), how far you have read it, what study material it has, and the
 * theme its library card shelves it under (`catalogue-document`). The spines are dyed by
 * the dimension the reader picks, the overview draws each dimension as a bar of its
 * buckets, and picking a bucket filters the shelf to it. The dyes keep one meaning across
 * the fixed dimensions: slate is "nothing yet", forest is "done", ochre is "waiting on
 * you", ink is "under way". Themes come from the shelf itself, so their buckets do too
 * (`shelfPalette`): the most used get a dye each, the rest share stone.
 */
import type { ArtifactCounts, Genre } from '../../lib/api/types/documents';
import type { ShelfReading } from './progress';

export const DIMENSIONS = ['kind', 'reading', 'study', 'theme'] as const;
export type Dimension = (typeof DIMENSIONS)[number];

export const DEFAULT_DIMENSION: Dimension = 'kind';

export const DIMENSION_LABELS: Record<Dimension, string> = {
  kind: 'Kind',
  reading: 'Reading',
  study: 'Study material',
  theme: 'Theme',
};

/** Bookcloth dyes, dark enough for the spine's paper-coloured type (>= 7:1 on #f5efe0). */
export const DYES = {
  ink: '#27398a',
  teal: '#0e5858',
  plum: '#652a5d',
  forest: '#2b5220',
  ochre: '#6b4509',
  rust: '#7f3419',
  stone: '#56503f',
  slate: '#474d56',
} as const;
export type Dye = keyof typeof DYES;

export interface Bucket {
  value: string;
  label: string;
  dye: Dye;
}

export const FIXED_BUCKETS = {
  kind: [
    { value: 'book', label: 'Books', dye: 'ink' },
    { value: 'paper', label: 'Papers', dye: 'teal' },
    { value: 'article', label: 'Articles', dye: 'plum' },
  ],
  reading: [
    { value: 'reading', label: 'Reading', dye: 'ink' },
    { value: 'finished', label: 'Finished', dye: 'forest' },
    { value: 'unread', label: 'Not started', dye: 'slate' },
  ],
  study: [
    { value: 'ready', label: 'Ready to study', dye: 'forest' },
    { value: 'drafts', label: 'Drafts only', dye: 'ochre' },
    { value: 'none', label: 'Nothing yet', dye: 'slate' },
  ],
} as const satisfies Record<Exclude<Dimension, 'theme'>, readonly Bucket[]>;

export type ReadingBucket = (typeof FIXED_BUCKETS.reading)[number]['value'];
export type StudyBucket = (typeof FIXED_BUCKETS.study)[number]['value'];

export const READING_BUCKETS = FIXED_BUCKETS.reading.map((b) => b.value);
export const STUDY_BUCKETS = FIXED_BUCKETS.study.map((b) => b.value);

/** The theme bucket of a book without a library card yet. */
export const NO_THEME = 'none';
export const NO_THEME_LABEL = 'No theme yet';
/** Themes, most used first, take these dyes in turn; the rest share stone. */
const THEME_DYES: readonly Dye[] = ['ink', 'teal', 'plum', 'forest', 'ochre', 'rust'];

/** The URL filter each dimension's buckets set (`?genre=paper`, `?reading=finished`, `?theme=…`). */
export const FACET_FILTERS = { kind: 'genre', reading: 'reading', study: 'study', theme: 'theme' } as const satisfies Record<
  Dimension,
  string
>;

/** Where a book sits in each dimension. */
export interface Buckets { kind: Genre; reading: ReadingBucket; study: StudyBucket; theme: string }

/** Every dimension's buckets, in order, for one shelf. */
export type Palette = Record<Dimension, readonly Bucket[]>;

export function readingBucket(reading: Pick<ShelfReading, 'share' | 'lastRead'>): ReadingBucket {
  if (!reading.lastRead) return 'unread';
  return reading.share >= 1 ? 'finished' : 'reading';
}

/** Approved material makes a book ready; drafts alone wait for review. */
export function studyBucket(artifacts: Pick<ArtifactCounts, 'approved' | 'draft' | 'needs_review'>): StudyBucket {
  if (artifacts.approved > 0) return 'ready';
  return artifacts.draft + artifacts.needs_review > 0 ? 'drafts' : 'none';
}

export function themeOf(doc: { catalogue?: { theme: string | null } | null }): string {
  return doc.catalogue?.theme ?? NO_THEME;
}

export function bucketsOf(
  doc: { genre: Genre; artifacts: ArtifactCounts; catalogue?: { theme: string | null } | null },
  reading: ShelfReading,
): Buckets {
  return { kind: doc.genre, reading: readingBucket(reading), study: studyBucket(doc.artifacts), theme: themeOf(doc) };
}

/** The shelf's buckets: the fixed dimensions, and its themes most used first (then A to Z), "No theme yet" last. */
export function shelfPalette(docs: readonly { catalogue?: { theme: string | null } | null }[]): Palette {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const theme = themeOf(doc);
    if (theme !== NO_THEME) counts.set(theme, (counts.get(theme) ?? 0) + 1);
  }
  const themes = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value], i): Bucket => ({ value, label: value, dye: THEME_DYES[i] ?? 'stone' }));
  return { ...FIXED_BUCKETS, theme: [...themes, { value: NO_THEME, label: NO_THEME_LABEL, dye: 'slate' }] };
}

/** The palette of a shelf with no themes yet: enough wherever only the fixed dimensions matter. */
export const FIXED_PALETTE: Palette = shelfPalette([]);

/** A bucket's place in its dimension (the order of the overview bar and the grouped shelf). */
export function bucketIndex(palette: Palette, dimension: Dimension, value: string): number {
  const at = palette[dimension].findIndex((b) => b.value === value);
  return at < 0 ? palette[dimension].length : at;
}

export function bucketOf(palette: Palette, dimension: Dimension, value: string): Bucket {
  return palette[dimension].find((b) => b.value === value) ?? { value, label: value, dye: dimension === 'theme' ? 'stone' : 'slate' };
}

export function dyeOf(palette: Palette, dimension: Dimension, value: string): string {
  return DYES[bucketOf(palette, dimension, value).dye];
}

export interface FacetSegment extends Bucket {
  count: number;
  /** 0–1 of the books counted. */
  share: number;
}

/** Every bucket of a dimension with its count, in the dimension's order (empty buckets included). */
export function facet(palette: Palette, dimension: Dimension, books: readonly Buckets[]): FacetSegment[] {
  const total = books.length;
  return palette[dimension].map((bucket) => {
    const count = books.filter((b) => b[dimension] === bucket.value).length;
    return { ...bucket, count, share: total ? count / total : 0 };
  });
}

export function parseDimension(value: string | null | undefined): Dimension {
  return (DIMENSIONS as readonly string[]).includes(value ?? '') ? (value as Dimension) : DEFAULT_DIMENSION;
}

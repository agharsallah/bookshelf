/**
 * Sample figures for the styleguide's encouragement section: badges at every state, and
 * each moment's copy in both voices.
 */
import type { Totals } from '../../lib/api/types/readerStats';
import { badgeStatuses, type BadgeSource, type BadgeStatus } from '../cheer/badges';
import { bookCheer, chapterDone, goalLine, recallCheer, reviewsDone, streakLine, type CheerLine } from '../cheer/lines';

const totals: Totals = {
  seconds: 31 * 3600, reading_seconds: 24 * 3600, listening_seconds: 3 * 3600, study_seconds: 4 * 3600,
  active_days: 41, sessions: 120, mean_session_seconds: 900, median_session_seconds: 720,
  longest_session_seconds: 2700, current_streak: 6, longest_streak: 12, books_started: 6, books_finished: 3,
  chapters_finished: 62, words_read: 280_000, pages_read: 900, words_per_minute: 240, notes: 140, highlights: 90,
  words_written: 9000, recalls: 4, predictions: 0, reviews: 640, retention: 0.93,
};

/** A reader part way along: some badges earned, some in progress, some untouched. */
export const SAMPLE_SOURCE: BadgeSource = {
  totals,
  hours: [
    { weekday: 0, hour: 23, seconds: 12 * 3600 },
    { weekday: 2, hour: 13, seconds: 19 * 3600 },
  ],
  depth: [
    { depth: 'opened', books: 6 },
    { depth: 'read', books: 5 },
    { depth: 'annotated', books: 4 },
    { depth: 'recalled', books: 2 },
    { depth: 'reviewed', books: 1 },
  ],
};

export const SAMPLE_BADGES = badgeStatuses(SAMPLE_SOURCE);

const chapters = (n: number): BadgeStatus => {
  const found = badgeStatuses({ ...SAMPLE_SOURCE, totals: { ...totals, chapters_finished: n } }).find((b) => b.def.id === 'chapters');
  if (!found) throw new Error('no chapters badge');
  return found;
};

/** One badge through its states. */
export const BADGE_STATES: { label: string; status: BadgeStatus; fresh?: boolean }[] = [
  { label: 'Locked, untouched', status: chapters(0) },
  { label: 'Earned, early in a level', status: chapters(12) },
  { label: 'Earned, near the next', status: chapters(90) },
  { label: 'New since the last look', status: chapters(25), fresh: true },
  { label: 'Top level', status: chapters(600) },
];

const book = { title: 'Deep Work', finished: 3, total: 10, kind: 'continue' as const };

/** Every moment, with what triggers it. */
export const MOMENTS: { label: string; line: CheerLine | null }[] = [
  { label: 'Streak kept, a personal best', line: streakLine({ streak: 12, longest: 12, activeToday: true }) },
  { label: 'Streak kept', line: streakLine({ streak: 6, longest: 12, activeToday: true }) },
  { label: 'Streak open today', line: streakLine({ streak: 6, longest: 12, activeToday: false }) },
  { label: 'Day one', line: streakLine({ streak: 1, longest: 12, activeToday: true }) },
  { label: 'After a break', line: streakLine({ streak: 0, longest: 12, activeToday: false }) },
  { label: 'Goal, not started', line: goalLine(20, 0) },
  { label: 'Goal, part way', line: goalLine(20, 12 * 60) },
  { label: 'Goal met', line: goalLine(20, 24 * 60) },
  { label: 'Book, starting', line: bookCheer({ ...book, kind: 'start', progress: 0, finished: 0 }, 'styleguide') },
  { label: 'Book, early', line: bookCheer({ ...book, progress: 0.1, finished: 1 }, 'styleguide') },
  { label: 'Book, a quarter in', line: bookCheer({ ...book, progress: 0.3 }, 'styleguide') },
  { label: 'Book, past halfway', line: bookCheer({ ...book, progress: 0.6, finished: 6 }, 'styleguide') },
  { label: 'Book, last quarter', line: bookCheer({ ...book, progress: 0.8, finished: 7 }, 'styleguide') },
  { label: 'Book, two chapters left', line: bookCheer({ ...book, progress: 0.8, finished: 8 }, 'styleguide') },
  { label: 'Book, one chapter left', line: bookCheer({ ...book, progress: 0.9, finished: 9 }, 'styleguide') },
  { label: 'Reviews done, knew most', line: reviewsDone(12, 11) },
  { label: 'Reviews done, a hard session', line: reviewsDone(12, 5) },
  { label: 'Recall, near-perfect', line: recallCheer(9, 1, 10) },
  { label: 'Recall, most of it', line: recallCheer(6, 2, 10) },
  { label: 'Recall, a little', line: recallCheer(2, 0, 10) },
  { label: 'Recall, a blank', line: recallCheer(0, 0, 10) },
  { label: 'Chapter finished', line: chapterDone('Rule 2 · Embrace Boredom', null) },
  { label: 'Book finished', line: chapterDone('Conclusion', 'Deep Work') },
];

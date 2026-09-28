/** The headline figures of a reader statistics page, as stat tiles. */
import type { Tile } from '../stats/StatTiles';
import type { Totals } from '../../lib/api/types/readerStats';
import { formatCount, formatPercent, formatTime, NONE, plural } from './format';

export function readerTiles(t: Totals): Tile[] {
  return [
    { label: 'Time with books', value: formatTime(t.seconds), note: `${formatTime(t.reading_seconds)} reading · ${formatTime(t.listening_seconds)} listening` },
    { label: 'Study', value: formatTime(t.study_seconds), note: 'study, recall and review' },
    { label: 'Active days', value: formatCount(t.active_days), note: `${plural(t.current_streak, 'day')} streak · best ${t.longest_streak}` },
    { label: 'Sittings', value: formatCount(t.sessions), note: t.median_session_seconds ? `typically ${formatTime(t.median_session_seconds)} · longest ${formatTime(t.longest_session_seconds)}` : undefined },
    { label: 'Books', value: `${t.books_finished} / ${t.books_started}`, note: 'finished / started' },
    { label: 'Chapters finished', value: formatCount(t.chapters_finished) },
    { label: 'Words read', value: formatCount(t.words_read), note: `about ${plural(t.pages_read, 'page')}` },
    { label: 'Reading speed', value: t.words_per_minute ? `${Math.round(t.words_per_minute)} wpm` : NONE, note: 'words per minute, in chapters you read through' },
    { label: 'Notes', value: formatCount(t.notes), note: `${plural(t.highlights, 'highlight')} · ${plural(t.words_written, 'word')} written` },
    { label: 'Recalls', value: formatCount(t.recalls), note: plural(t.predictions, 'prediction') },
    { label: 'Reviews', value: formatCount(t.reviews), note: t.retention !== null ? `${formatPercent(t.retention)} remembered` : undefined },
  ];
}

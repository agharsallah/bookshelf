/**
 * Encouragement, in both voices: the streak and the daily goal on Today, a nudge about the
 * book you are in, the end of the day's reviews, a graded recall and a finished chapter.
 * Quiet lines keep the app's voice: plain, specific, never loud. Playful lines are the
 * same facts with emoji and exclamation marks. Pure functions; `null` means nothing worth
 * saying.
 */
import type { CheerTone } from './prefs';

export interface CheerLine {
  quiet: string;
  playful: string;
}

const same = (text: string): CheerLine => ({ quiet: text, playful: text });

export const pick = (line: CheerLine, tone: CheerTone): string => line[tone];

const days = (n: number) => `${n.toLocaleString('en')} ${n === 1 ? 'day' : 'days'}`;

/** A stable choice among `options` for one `seed` (the day, say): fresh tomorrow, the same all day. */
export function rotate<T>(options: readonly T[], seed: string): T | undefined {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return options[Math.abs(hash) % Math.max(1, options.length)];
}

export interface StreakState {
  /** Active days in a row, up to today or yesterday. */
  streak: number;
  longest: number;
  /** Whether today already counts. */
  activeToday: boolean;
}

/** Where the run of days stands: kept, at risk today, a personal best, or ready to restart. */
export function streakLine({ streak, longest, activeToday }: StreakState): CheerLine | null {
  const best = streak >= 3 && streak >= longest;
  if (streak >= 2 && activeToday) {
    return best
      ? { quiet: `${days(streak)} in a row, your longest run yet.`, playful: `🔥 ${days(streak)} in a row: a new personal best!` }
      : { quiet: `${days(streak)} in a row. Your best is ${days(longest)}.`, playful: `🔥 ${streak}-day streak! Best: ${days(longest)}.` };
  }
  if (streak >= 1 && !activeToday) {
    return {
      quiet: `${days(streak)} in a row so far. A few pages today keep it going.`,
      playful: `🔥 Your ${streak}-day streak is on the line. Ten minutes saves it!`,
    };
  }
  if (streak === 1 && activeToday) return { quiet: 'Day one of a new run.', playful: '🌱 Day one: a streak starts here!' };
  if (longest >= 3) {
    return { quiet: `A new run starts with today. Your best is ${days(longest)}.`, playful: `💪 Start a new streak today. Can you beat ${days(longest)}?` };
  }
  return null;
}

/** Today's minutes against the goal; null with no goal set. */
export function goalLine(goalMinutes: number, todaySeconds: number): CheerLine | null {
  if (goalMinutes <= 0) return null;
  const minutes = Math.floor(todaySeconds / 60);
  if (minutes >= goalMinutes) {
    return { quiet: `Today's ${goalMinutes} minutes: done.`, playful: `🎯 Goal smashed: ${minutes} of ${goalMinutes} minutes!` };
  }
  const left = goalMinutes - minutes;
  if (minutes === 0) return { quiet: `${goalMinutes} minutes to read today.`, playful: `🎯 ${goalMinutes} minutes today. Let's go!` };
  return { quiet: `${minutes} of ${goalMinutes} minutes today, ${left} to go.`, playful: `🎯 ${minutes}/${goalMinutes} minutes: just ${left} more!` };
}

/** The book "Pick up" points at, as far as encouragement needs it. */
export interface BookStanding {
  title: string;
  /** 0–1 of the book. */
  progress: number;
  /** Chapters finished, of `total`. */
  finished: number;
  total: number;
  /** Starting it, or back in it. */
  kind: 'start' | 'continue';
}

/** A line after the day's plan, rotating by `seed` among what fits so it does not go stale. */
export function bookCheer(book: BookStanding | null, seed: string): CheerLine | null {
  if (!book) return null;
  const left = book.total - book.finished;
  const options: CheerLine[] = [];
  if (book.kind === 'start') {
    options.push(
      { quiet: 'A first chapter is the easiest one to begin.', playful: '📖 New book, fresh start. Chapter one awaits!' },
      { quiet: 'Every book you finished started with a first page.', playful: '🚀 Page one is the best page. Dive in!' },
    );
  } else if (left === 1) {
    options.push({ quiet: `One chapter left in ${book.title}.`, playful: `🏁 Just one chapter left in ${book.title}!` });
  } else if (left === 2) {
    options.push({ quiet: `Two chapters left in ${book.title}.`, playful: `🏁 Only two chapters to go in ${book.title}!` });
  } else if (book.progress >= 0.75) {
    options.push(
      { quiet: 'The last quarter: the end is in sight.', playful: '🏃 The finish line is in sight!' },
      { quiet: `${Math.round(book.progress * 100)}% read. The rest will go quickly.`, playful: `⚡ ${Math.round(book.progress * 100)}% done. Bring it home!` },
    );
  } else if (book.progress >= 0.5) {
    options.push(
      { quiet: 'Past halfway.', playful: '🎉 Past the halfway mark!' },
      { quiet: 'More behind you than ahead.', playful: '⛰️ Over the hump: it is downhill from here!' },
    );
  } else if (book.progress >= 0.25) {
    options.push({ quiet: 'A quarter in, and settling into it.', playful: '📈 A quarter done. Momentum is building!' });
  } else if (book.progress > 0) {
    options.push(
      { quiet: 'The opening chapters ask the most. It gets easier.', playful: '🌱 Early days. Every page counts!' },
      { quiet: 'A chapter a day finishes most books within a month.', playful: '📅 A chapter a day keeps the bookmark moving!' },
    );
  }
  return rotate(options, `${seed}:${book.title}`) ?? null;
}

/** The end of the day's reviews: how many, how many you knew. */
export function reviewsDone(reviewed: number, knew: number): CheerLine {
  if (reviewed === 0) return same('Nothing is due today. Cards from your recalls and flashcards come back here on the day they are due.');
  const share = knew / reviewed;
  const cards = `${reviewed.toLocaleString('en')} ${reviewed === 1 ? 'card' : 'cards'}`;
  if (share >= 0.8) {
    return {
      quiet: `All done: ${cards}, and you knew ${knew === reviewed ? 'every one' : `${knew} of them`}. They come back when they are due.`,
      playful: `🎉 Queue cleared! ${cards}, ${Math.round(share * 100)}% nailed. Your memory is on form!`,
    };
  }
  return {
    quiet: `All done: ${cards}. The ones that were hard come back sooner, which is how they stick.`,
    playful: `✅ Queue cleared: ${cards}! The tricky ones come back soon, and that's how they stick. 💪`,
  };
}

/** A recall's score, 0–1: recalled ideas plus half the partial ones. */
export const recallScore = (recalled: number, partial: number, total: number): number => (total === 0 ? 0 : (recalled + partial / 2) / total);

/** At or above it, a recall is near-perfect: worth a burst. */
export const NEARLY_ALL = 0.9;

/** Under a graded recall: what the score means for what comes next. */
export function recallCheer(recalled: number, partial: number, total: number): CheerLine | null {
  if (total === 0) return null;
  const score = recallScore(recalled, partial, total);
  if (score >= NEARLY_ALL) return { quiet: 'Nearly everything came back. This chapter is yours.', playful: '🏆 Outstanding recall. You own this chapter!' };
  if (score >= 0.6) return { quiet: 'Most of it came back. A review or two will fix the rest.', playful: '⭐ Solid recall! A quick review and it is locked in.' };
  if (score > 0) {
    return {
      quiet: 'Recalling is harder than rereading, and stays longer. What you missed comes back to you.',
      playful: '💡 Tough one, but effortful recall is what makes it stick. You have got this!',
    };
  }
  return { quiet: 'A blank is common on a first try. Trying to recall it still helps it stay.', playful: '🌱 Blank page? Totally normal. The attempt itself plants the seed!' };
}

/** Reaching the end of a chapter, or of the book. */
export function chapterDone(chapter: string, book: string | null): CheerLine {
  if (book) return { quiet: `You finished ${book}.`, playful: `🏆 You finished ${book}! What a read!` };
  return { quiet: `${chapter} finished.`, playful: `✨ ${chapter} done. Nice work!` };
}

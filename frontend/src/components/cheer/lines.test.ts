import { describe, expect, it } from 'vitest';
import { bookCheer, chapterDone, goalLine, recallCheer, reviewsDone, rotate, streakLine, type BookStanding } from './lines';

describe('streakLine', () => {
  it('praises a run kept today, and a personal best above all', () => {
    expect(streakLine({ streak: 6, longest: 6, activeToday: true })?.quiet).toBe('6 days in a row, your longest run yet.');
    expect(streakLine({ streak: 4, longest: 9, activeToday: true })?.quiet).toBe('4 days in a row. Your best is 9 days.');
  });

  it('asks for a few pages when the run is still open today', () => {
    expect(streakLine({ streak: 3, longest: 5, activeToday: false })?.playful).toMatch(/3-day streak is on the line/);
  });

  it('marks a first day, invites a restart after a long run, and is silent otherwise', () => {
    expect(streakLine({ streak: 1, longest: 1, activeToday: true })?.quiet).toBe('Day one of a new run.');
    expect(streakLine({ streak: 0, longest: 12, activeToday: false })?.quiet).toMatch(/best is 12 days/);
    expect(streakLine({ streak: 0, longest: 2, activeToday: false })).toBeNull();
  });
});

describe('goalLine', () => {
  it('counts down to the goal and says when it is met', () => {
    expect(goalLine(0, 600)).toBeNull();
    expect(goalLine(20, 0)?.quiet).toBe('20 minutes to read today.');
    expect(goalLine(20, 12 * 60 + 30)?.quiet).toBe('12 of 20 minutes today, 8 to go.');
    expect(goalLine(20, 25 * 60)?.quiet).toBe("Today's 20 minutes: done.");
  });
});

describe('bookCheer', () => {
  const book = (over: Partial<BookStanding>): BookStanding => ({ title: 'Deep Work', progress: 0.3, finished: 3, total: 10, kind: 'continue', ...over });

  it('counts the last chapters down by name', () => {
    expect(bookCheer(book({ finished: 9, progress: 0.9 }), '2026-10-03')?.quiet).toBe('One chapter left in Deep Work.');
    expect(bookCheer(book({ finished: 8, progress: 0.8 }), '2026-10-03')?.quiet).toBe('Two chapters left in Deep Work.');
  });

  it('fits the line to how far you are, the same all day', () => {
    const half = bookCheer(book({ progress: 0.6, finished: 6 }), '2026-10-03');
    expect(['Past halfway.', 'More behind you than ahead.']).toContain(half?.quiet);
    expect(bookCheer(book({ progress: 0.6, finished: 6 }), '2026-10-03')).toEqual(half);
    expect(bookCheer(book({ kind: 'start', progress: 0, finished: 0 }), 'x')?.quiet).toMatch(/first/i);
  });

  it('has nothing to say with no book', () => {
    expect(bookCheer(null, 'x')).toBeNull();
  });
});

describe('rotate', () => {
  it('spreads seeds over the options', () => {
    const picks = new Set(Array.from({ length: 20 }, (_, i) => rotate(['a', 'b', 'c'], `2026-10-${i}`)));
    expect(picks.size).toBeGreaterThan(1);
    expect(rotate([], 'x')).toBeUndefined();
  });
});

describe('reviewsDone', () => {
  it('tells how many you knew, and is kind about a hard session', () => {
    expect(reviewsDone(0, 0).quiet).toMatch(/^Nothing is due today/);
    expect(reviewsDone(5, 5).quiet).toBe('All done: 5 cards, and you knew every one. They come back when they are due.');
    expect(reviewsDone(10, 9).playful).toMatch(/90% nailed/);
    expect(reviewsDone(10, 3).quiet).toMatch(/hard come back sooner/);
  });
});

describe('recallCheer', () => {
  it('reads the score, partial ideas counting half', () => {
    expect(recallCheer(0, 0, 0)).toBeNull();
    expect(recallCheer(9, 1, 10)?.quiet).toMatch(/This chapter is yours/);
    expect(recallCheer(5, 2, 10)?.quiet).toMatch(/Most of it came back/);
    expect(recallCheer(1, 0, 10)?.quiet).toMatch(/stays longer/);
    expect(recallCheer(0, 0, 4)?.quiet).toMatch(/A blank is common/);
  });
});

describe('chapterDone', () => {
  it('names the chapter, or the book when it is the last', () => {
    expect(chapterDone('Rule 1', null).quiet).toBe('Rule 1 finished.');
    expect(chapterDone('Rule 4', 'Deep Work').quiet).toBe('You finished Deep Work.');
  });
});

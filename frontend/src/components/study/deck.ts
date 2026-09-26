/**
 * The flashcard deck as plain state: which cards this pass goes through (`order`, card
 * indexes), where you are, whether the card is turned, and what you marked. Marks
 * outlive a pass (and the page, via `readMarks` / `writeMarks`); a pass is restarted with
 * `begin`, e.g. with only the cards you missed.
 */

export type Mark = 'knew' | 'learning';
/** Card index → your mark. Unmarked cards are absent. */
export type Marks = Readonly<Record<number, Mark>>;

export interface DeckState {
  order: readonly number[];
  /** Index into `order`; equal to its length once the pass is over. */
  position: number;
  turned: boolean;
  marks: Marks;
}

export type DeckAction =
  | { type: 'turn' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'mark'; mark: Mark }
  | { type: 'begin'; order: readonly number[] }
  | { type: 'restore'; marks: Marks }
  | { type: 'forget' };

export function startDeck(order: readonly number[], marks: Marks = {}): DeckState {
  return { order, position: 0, turned: false, marks };
}

export function deckReducer(state: DeckState, action: DeckAction): DeckState {
  const done = isFinished(state);
  switch (action.type) {
    case 'turn':
      return done ? state : { ...state, turned: !state.turned };
    case 'next':
      return done ? state : { ...state, position: state.position + 1, turned: false };
    case 'previous':
      return state.position === 0 ? state : { ...state, position: state.position - 1, turned: false };
    case 'mark': {
      const card = currentCard(state);
      if (card === null) return state;
      return { ...state, marks: { ...state.marks, [card]: action.mark }, position: state.position + 1, turned: false };
    }
    case 'begin':
      return startDeck(action.order, state.marks);
    case 'restore':
      return { ...state, marks: action.marks };
    case 'forget':
      return { ...state, marks: {} };
  }
}

export function isFinished(state: DeckState): boolean {
  return state.position >= state.order.length;
}

/** The card index in view, or null once the pass is over. */
export function currentCard(state: DeckState): number | null {
  return state.order[state.position] ?? null;
}

/** Distinct topics, in the order the deck meets them. */
export function topicsOf(cards: readonly { group: string | null }[]): string[] {
  return [...new Set(cards.map((c) => c.group).filter((g): g is string => g !== null))];
}

/** Every card index, or only one topic's. */
export function orderFor(cards: readonly { group: string | null }[], topic: string | null = null): number[] {
  return cards.flatMap((card, index) => (topic === null || card.group === topic ? [index] : []));
}

/** A shuffled copy (Fisher–Yates); `random` returns [0, 1). */
export function shuffle(order: readonly number[], random: () => number = Math.random): number[] {
  const out = [...order];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j] as number, out[i] as number];
  }
  return out;
}

/** The cards of a pass you did not mark as known (still learning, or skipped). */
export function missedIn(order: readonly number[], marks: Marks): number[] {
  return order.filter((card) => marks[card] !== 'knew');
}

export interface Tally {
  knew: number;
  learning: number;
  unmarked: number;
  total: number;
}

export function tally(order: readonly number[], marks: Marks): Tally {
  const out: Tally = { knew: 0, learning: 0, unmarked: 0, total: order.length };
  for (const card of order) {
    const mark = marks[card];
    if (mark === 'knew') out.knew++;
    else if (mark === 'learning') out.learning++;
    else out.unmarked++;
  }
  return out;
}

export function marksKey(artifactId: string): string {
  return `bookshelf:flashcards:${artifactId}`;
}

/** Stored marks, keeping only valid entries for cards that exist. */
export function parseMarks(raw: string | null, cardCount: number): Marks {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const marks: Record<number, Mark> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const card = Number(key);
    if (Number.isInteger(card) && card >= 0 && card < cardCount && (value === 'knew' || value === 'learning')) marks[card] = value;
  }
  return marks;
}

/** Marks saved for an artifact; empty when storage is blocked or holds nothing usable. */
export function readMarks(storage: Pick<Storage, 'getItem'> | undefined, artifactId: string, cardCount: number): Marks {
  try {
    return parseMarks(storage?.getItem(marksKey(artifactId)) ?? null, cardCount);
  } catch {
    return {};
  }
}

/** Best effort: the deck works the same when storage is unavailable. */
export function writeMarks(storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined, artifactId: string, marks: Marks): void {
  try {
    if (Object.keys(marks).length === 0) storage?.removeItem(marksKey(artifactId));
    else storage?.setItem(marksKey(artifactId), JSON.stringify(marks));
  } catch {
    // Storage blocked or full: the marks last for this visit only.
  }
}

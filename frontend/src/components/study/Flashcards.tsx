/**
 * The flashcard deck (island). Read the prompt, turn the card, say whether you knew it;
 * marking moves to the next card. A pass can be narrowed to one topic or shuffled, and
 * ends with how many you knew and the option to study only the ones you missed.
 *
 * Keys: Space/Enter turns, ←/→ move, K "I knew it", L "Still learning". Marks are kept
 * per artifact in localStorage when it is available, so they survive a reload.
 */
import { useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import {
  currentCard,
  deckReducer,
  isFinished,
  missedIn,
  orderFor,
  readMarks,
  shuffle,
  startDeck,
  tally,
  topicsOf,
  writeMarks,
  type DeckAction,
  type Marks,
} from './deck';
import { Card, Progress, Summary } from './DeckParts';
import { shortcutApplies } from './keys';
import { Kbd, ReaderCites } from './ReaderCites';
import { plainText, type Flashcard } from './study-body';
import styles from './Flashcards.module.css';
import shared from './Study.module.css';

export interface FlashcardsProps {
  slug: string;
  /** Marks are remembered per artifact version. */
  artifactId: string;
  cards: Flashcard[];
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function Flashcards({ slug, artifactId, cards }: FlashcardsProps) {
  const [state, dispatch] = useReducer(deckReducer, cards, (c) => startDeck(orderFor(c)));
  const [topic, setTopic] = useState<string | null>(null);
  const [shuffled, setShuffled] = useState(false);
  const initialMarks = useRef<Marks>(state.marks);
  const turnButton = useRef<HTMLButtonElement>(null);
  const topics = topicsOf(cards);
  const index = currentCard(state);
  const card = index === null ? null : cards[index];
  const finished = isFinished(state);
  const counts = tally(state.order, state.marks);

  useEffect(() => {
    dispatch({ type: 'restore', marks: readMarks(storage(), artifactId, cards.length) });
  }, [artifactId, cards.length]);

  useEffect(() => {
    if (state.marks !== initialMarks.current) writeMarks(storage(), artifactId, state.marks);
  }, [artifactId, state.marks]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutApplies(event)) return;
      const action = keyAction(event.key, state.turned);
      if (!action) return;
      event.preventDefault();
      dispatch(action);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state.turned]);

  const begin = (order: readonly number[]) => {
    dispatch({ type: 'begin', order });
    requestAnimationFrame(() => turnButton.current?.focus());
  };
  const passOrder = (nextTopic: string | null, mixed: boolean) => {
    const order = orderFor(cards, nextTopic);
    return mixed ? shuffle(order) : order;
  };

  return (
    <ReaderCites slug={slug}>
      <section className={styles.deck} aria-label="Flashcards">
        <div className={shared.toolbar}>
          {topics.length > 1 ? (
            <label className={styles.topic}>
              <span>Topic</span>
              <select
                value={topic ?? ''}
                onChange={(event) => {
                  const next = event.target.value || null;
                  setTopic(next);
                  dispatch({ type: 'begin', order: passOrder(next, shuffled) });
                }}
              >
                <option value="">All topics</option>
                {topics.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn-quiet"
            aria-pressed={shuffled}
            onClick={() => {
              setShuffled(!shuffled);
              dispatch({ type: 'begin', order: passOrder(topic, !shuffled) });
            }}
          >
            {shuffled ? 'Shuffled' : 'Shuffle'}
          </button>
          <span className={shared.spacer} />
          <span className={shared.count}>
            {finished ? `${counts.total} cards` : `Card ${state.position + 1} of ${counts.total}`}
            {counts.knew > 0 ? `, ${counts.knew} known` : ''}
          </span>
        </div>

        <Progress order={state.order} position={state.position} marks={state.marks} />

        <p className="visually-hidden" aria-live="polite">
          {card ? (state.turned ? `Answer: ${plainText(card.back)}` : `Card ${state.position + 1} of ${counts.total}: ${card.front}`) : ''}
        </p>

        {card && index !== null ? (
          <>
            <Card key={`${index}@${state.position}`} card={card} turned={state.turned} mark={state.marks[index]} onTurn={() => dispatch({ type: 'turn' })} />
            <Controls state={state} dispatch={dispatch} turnButton={turnButton} />
          </>
        ) : (
          <Summary
            tally={counts}
            missed={missedIn(state.order, state.marks).length}
            onMissed={() => begin(missedIn(state.order, state.marks))}
            onAgain={() => begin(passOrder(topic, shuffled))}
            onForget={() => {
              dispatch({ type: 'forget' });
              begin(passOrder(topic, shuffled));
            }}
          />
        )}
      </section>
    </ReaderCites>
  );
}

/** What a key does: turn, move, or mark (marking once the card is turned). */
function keyAction(key: string, turned: boolean): DeckAction | null {
  switch (key) {
    case ' ':
    case 'Enter':
      return { type: 'turn' };
    case 'ArrowRight':
      return { type: 'next' };
    case 'ArrowLeft':
      return { type: 'previous' };
    case 'k':
    case 'K':
      return turned ? { type: 'mark', mark: 'knew' } : null;
    case 'l':
    case 'L':
      return turned ? { type: 'mark', mark: 'learning' } : null;
    default:
      return null;
  }
}

interface ControlsProps {
  state: { position: number; turned: boolean };
  dispatch: (action: DeckAction) => void;
  turnButton: RefObject<HTMLButtonElement | null>;
}

/** Before turning: turn the card. After: say how it went, or turn it back. */
function Controls({ state, dispatch, turnButton }: ControlsProps) {
  const mark = (value: 'knew' | 'learning') => {
    dispatch({ type: 'mark', mark: value });
    turnButton.current?.focus();
  };
  return (
    <div className={styles.controls}>
      <button type="button" className="btn btn-quiet" disabled={state.position === 0} aria-keyshortcuts="ArrowLeft" onClick={() => dispatch({ type: 'previous' })}>
        <Kbd>←</Kbd> Previous
      </button>
      <div className={styles.primary}>
        {state.turned ? (
          <>
            <button type="button" className="btn" aria-keyshortcuts="L" onClick={() => mark('learning')}>
              Still learning <Kbd>L</Kbd>
            </button>
            <button type="button" className="btn btn-primary" aria-keyshortcuts="K" onClick={() => mark('knew')}>
              I knew it <Kbd>K</Kbd>
            </button>
          </>
        ) : null}
        <button
          ref={turnButton}
          type="button"
          className={state.turned ? 'btn btn-quiet' : 'btn btn-primary'}
          aria-keyshortcuts="Space"
          onClick={() => dispatch({ type: 'turn' })}
        >
          {state.turned ? 'Turn back' : 'Turn the card'} <Kbd>Space</Kbd>
        </button>
      </div>
      <button type="button" className="btn btn-quiet" aria-keyshortcuts="ArrowRight" onClick={() => dispatch({ type: 'next' })}>
        Next <Kbd>→</Kbd>
      </button>
    </div>
  );
}

export default Flashcards;

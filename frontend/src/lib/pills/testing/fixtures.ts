/**
 * Pill fixtures for tests: one example per kind, shaped as `contracts/pill.schema.json`
 * describes them, and builders for sessions and pages. Ids are valid uuids built from a
 * counter, so every run is the same.
 */
import { defaultConfig } from '../config';
import type {
  EventsResult,
  Feed,
  FeedList,
  GenerateResult,
  Pill,
  PillBodies,
  PillDocument,
  PillKind,
  PillOf,
  PillSession,
  RebuildResult,
  SessionContinuation,
  SessionStart,
  SessionSummary,
  Supply,
} from '../types';

export const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

export const MEADOWS: PillDocument = {
  id: uuid(9001),
  slug: 'meadows-systems',
  title: 'Thinking in Systems',
  genre: 'book',
  theme: 'Systems',
};

export const BODIES: PillBodies = {
  insight: {
    spans: [{ text: 'Changing the rules of a system moves it further than tuning its numbers.', cites: ['ch06/s01/p003'] }],
    why: [{ text: 'Parameters rarely change behaviour; structure does.', cites: ['ch06/s01/p004'] }],
  },
  remember: { spans: [{ text: 'Stocks change only through their flows.', cites: ['ch01/p010'] }] },
  antipattern: { spans: [{ text: 'Pushing harder on a balancing loop only makes it push back harder.', cites: ['ch05/p002'] }] },
  quote: { text: 'A system is more than the sum of its parts.', page: 11, attribution: 'Donella Meadows' },
  definition: { term: 'Stock', spans: [{ text: 'An accumulation you can see, count or measure at any moment.', cites: ['ch01/p004'] }] },
  number: { value: '12', label: [{ text: 'places to intervene in a system, from least to most effective', cites: ['ch06/p001'] }] },
  figure: {
    image_url: 'media/meadows-systems/fig-1-1.png',
    caption: 'A bathtub: one stock, one inflow, one outflow.',
    takeaway: [{ text: 'The level rises whenever inflow beats outflow.', cites: ['ch01/p012'] }],
  },
  diagram: {
    diagram: {
      type: 'diagram',
      nodes: [
        { id: 'a', label: 'Inflow' },
        { id: 'b', label: 'Stock' },
      ],
      edges: [{ from: 'a', to: 'b', label: 'fills' }],
      cites: ['ch01/p012'],
    },
    caption: 'How a stock fills',
  },
  quiz: {
    question: 'What changes a stock?',
    choices: ['Its flows', 'Its name', 'Its goal'],
    answer: 0,
    explanation: [{ text: 'Only inflows and outflows change a stock.', cites: ['ch01/p010'] }],
  },
  flip: { front: 'What is a balancing loop?', back: [{ text: 'A loop that pulls a stock toward a goal.', cites: ['ch01/p020'] }] },
  claim: { text: 'Delays in feedback cause oscillation.', claim_kind: 'theory', strength: 'argued', support: { supports: 2, contradicts: 0, extends: 1 } },
  math: {
    latex: 'S_t = S_0 + \\int (in - out)\\,dt',
    name: 'Stock over time',
    plain: [{ text: 'The stock is where it started plus everything that came in minus what left.', cites: ['ch01/p011'] }],
    try_it: { question: 'In 5, out 3 for 2 hours from 10: what is the stock?', answer: [{ text: '14', cites: ['ch01/p011'] }] },
  },
  connection: {
    relation: 'echoes',
    concept: 'feedback loop',
    sides: [
      { document: { id: MEADOWS.id, slug: MEADOWS.slug, title: MEADOWS.title }, anchor: 'ch01/p020', spans: [{ text: 'Balancing loops seek goals.', cites: ['ch01/p020'] }] },
      { document: { id: uuid(9002), slug: 'wiener-cybernetics', title: 'Cybernetics' }, anchor: 'ch04/p007', spans: [{ text: 'Negative feedback steers toward a target.', cites: ['ch04/p007'] }] },
    ],
  },
  listen: {
    audio_url: 'audio/files/meadows-systems/summary/default.mp3',
    start_ms: 12_000,
    end_ms: 31_000,
    transcript: [{ text: 'Think of a bathtub filling while it drains.', cites: ['ch01/p012'] }],
  },
  hook: {
    spans: [{ text: 'Why does a thermostat overshoot?', cites: ['ch02/p003'] }],
    payoff: [{ text: 'Because the information it acts on is already old.', cites: ['ch02/p004'] }],
  },
  review: { prompt: 'Name the two kinds of feedback loop.', answer: [{ text: 'Balancing and reinforcing.', cites: ['ch01/p020'] }] },
};

let counter = 0;

/** A pill of `kind` with the example body; override anything. */
export function makePill<K extends PillKind>(kind: K, overrides: Partial<PillOf<K>> = {}): PillOf<K> {
  counter += 1;
  const body = BODIES[kind];
  return {
    id: uuid(counter),
    kind,
    document: MEADOWS,
    anchor: 'ch01',
    unit_title: 'The Basics',
    headline: `A ${kind} pill`,
    body,
    cites: ['ch01/p010'],
    sources: {},
    concepts: ['stock'],
    thread: null,
    est_seconds: 20,
    origin: kind === 'review' ? 'review:pill' : 'harvest:flashcards',
    draft: false,
    review_item_id: kind === 'review' ? uuid(7000 + counter) : null,
    ...overrides,
  } as PillOf<K>;
}

/** One example of every kind, in the contract's order. */
export function everyKind(): Pill[] {
  return (Object.keys(BODIES) as PillKind[]).map((kind) => makePill(kind) as Pill);
}

/** A thread of `size` pills sharing a key, in order. */
export function makeThread(key: string, size: number, title = 'The arc of a chapter'): Pill[] {
  return Array.from({ length: size }, (_, index) => makePill('insight', { thread: { key, index, size, title }, headline: `${title} ${index + 1}` }) as Pill);
}

export const EMPTY_SUPPLY: Supply = { unseen: 0, by_document: [], low: false };

export function makeSession(overrides: Partial<PillSession> = {}): PillSession {
  return { id: uuid(5000), config: defaultConfig(), seed: 42, position: 0, created_at: '2026-10-06T08:00:00Z', finished_at: null, ...overrides };
}

export function makeStart(pills: Pill[], next_cursor: string | null = null, extra: Partial<SessionStart> = {}): SessionStart {
  return { session: makeSession(), page: { pills, next_cursor }, supply: EMPTY_SUPPLY, ...extra };
}

export function makePage(pills: Pill[], next_cursor: string | null = null, done = next_cursor === null): SessionContinuation {
  return { pills, next_cursor, supply: EMPTY_SUPPLY, done };
}

const MEADOWS_REF = { id: MEADOWS.id, slug: MEADOWS.slug, title: MEADOWS.title };

const FULL_SUPPLY: Supply = {
  unseen: 12,
  by_document: [{ document: MEADOWS_REF, unseen: 12, generatable: [{ anchor: 'ch04', title: 'Delays', estimate_tokens: 12_400 }], undistilled: false }],
  low: true,
};

const FEED: Feed = { id: uuid(6000), name: 'Mornings', config: defaultConfig(), created_at: '', updated_at: '' };

/**
 * One fully populated value of each API response type, every optional field set, named as
 * the `api` examples in `contracts/pill.examples.json` are: `types.test.ts` compares their
 * shapes, so the TS types follow the backend's response models.
 */
export const API_FIXTURES: {
  session_start: SessionStart;
  session_continuation: SessionContinuation;
  finished: { summary: SessionSummary };
  events_result: EventsResult;
  supply: Supply;
  generate_result: GenerateResult;
  jobs_queued: RebuildResult;
  feed: Feed;
  feed_list: FeedList;
} = {
  session_start: { session: makeSession(), page: { pills: [makePill('quiz')], next_cursor: '1' }, supply: FULL_SUPPLY, notice: null },
  session_continuation: { pills: [makePill('quiz')], next_cursor: null, supply: FULL_SUPPLY, done: true, notice: null },
  finished: { summary: { seen: 8, saved: 2, answered: 3, correct: 2, due_tomorrow: 5, minutes: 4, next_read: { document: MEADOWS_REF, anchor: 'ch05', title: 'Delays' } } },
  events_result: { accepted: 3, duplicates: 1, ignored: 0 },
  supply: FULL_SUPPLY,
  generate_result: { jobs: [uuid(6001)], estimate_tokens: null },
  jobs_queued: { jobs: [uuid(6001)] },
  feed: FEED,
  feed_list: { items: [FEED] },
};

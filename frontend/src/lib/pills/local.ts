/**
 * A pills client for the read-only demo (docs/DEMO.md): the same `PillsClient`, but what a
 * visitor does stays in their browser. Sessions (config, seed, what was served), events and
 * saved feeds live in `storage`; each page comes from `GET /pills/compose`, the server's
 * own feed engine run over the browser's session, which writes nothing. The end card is
 * summed up here from the session's events.
 *
 * Generating and rebuilding are not available (the demo runs nothing): they go to the API
 * as usual, which refuses them.
 */
import type { ApiClient } from '../api/client';
import type { Rated, Rating } from '../api/types/recalls';
import { pillsClientOver, type PageRequest, type PillsClient } from './client';
import type { StorageAdapter } from './storage';
import type { EventsResult, Feed, FeedConfig, Pill, PillEvent, PillSession, SessionContinuation, SessionSummary, StartRequest, Supply } from './types';
import { MAX_EVENT_BATCH } from './types';

export const LOCAL_SESSIONS_KEY = 'bookshelf:demo:pill-sessions';
export const LOCAL_EVENTS_KEY = 'bookshelf:demo:pill-events';
export const LOCAL_FEEDS_KEY = 'bookshelf:demo:pill-feeds';

/** The sessions and events kept; older ones are dropped first. */
export const MAX_SESSIONS = 20;
export const MAX_EVENTS = 5000;

const PAGE = 10;
const EMPTY_SUPPLY: Supply = { unseen: 0, by_document: [], low: false };

interface LocalSession {
  session: PillSession;
  /** Pill ids served so far, in order. */
  served: string[];
  pills: Record<string, Pill>;
  /** The engine has nothing more to serve. */
  dry: boolean;
  supply: Supply;
  notice: string | null;
}

type Sessions = Record<string, LocalSession>;

export interface LocalPillsOptions {
  api: Pick<ApiClient, 'get' | 'post' | 'patch' | 'delete'>;
  storage: StorageAdapter;
  now?: () => Date;
  newId?: () => string;
  newSeed?: () => number;
}

async function read<T>(storage: StorageAdapter, key: string, fallback: T): Promise<T> {
  const raw = await storage.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const write = (storage: StorageAdapter, key: string, value: unknown) => storage.set(key, JSON.stringify(value));

/** The newest `max` sessions, by when they started. */
function newest(sessions: Sessions, max: number): Sessions {
  const kept = Object.values(sessions)
    .sort((a, b) => b.session.created_at.localeCompare(a.session.created_at))
    .slice(0, max);
  return Object.fromEntries(kept.map((s) => [s.session.id, s]));
}

/** The end card, from the events of one session. */
export function summarize(events: readonly PillEvent[]): SessionSummary {
  const seen = new Set<string>();
  const saved = new Set<string>();
  let answered = 0;
  let correct = 0;
  let ms = 0;
  for (const e of events) {
    const target = e.pill_id ?? e.review_item_id ?? '';
    if (e.kind === 'seen') seen.add(target);
    else if (e.kind === 'save') saved.add(target);
    else if (e.kind === 'unsave') saved.delete(target);
    else if (e.kind === 'answer') {
      answered += 1;
      if (e.value?.correct === true) correct += 1;
    } else if (e.kind === 'dwell' && typeof e.value?.ms === 'number') ms += e.value.ms;
  }
  return { seen: seen.size, saved: saved.size, answered, correct, due_tomorrow: 0, minutes: Math.round(ms / 60000), next_read: null };
}

export function createLocalPillsClient({
  api,
  storage,
  now = () => new Date(),
  newId = () => crypto.randomUUID(),
  newSeed = () => Math.floor(Math.random() * 2 ** 31),
}: LocalPillsOptions): PillsClient {
  const remote = pillsClientOver(api);
  const sessions = () => read<Sessions>(storage, LOCAL_SESSIONS_KEY, {});
  const events = () => read<PillEvent[]>(storage, LOCAL_EVENTS_KEY, []);
  const feeds = () => read<Feed[]>(storage, LOCAL_FEEDS_KEY, []);

  async function save(local: LocalSession): Promise<void> {
    const all = await sessions();
    await write(storage, LOCAL_SESSIONS_KEY, newest({ ...all, [local.session.id]: local }, MAX_SESSIONS));
  }

  async function load(sessionId: string): Promise<LocalSession> {
    const local = (await sessions())[sessionId];
    if (!local) throw new Error(`Pill session ${sessionId} is not kept in this browser.`);
    return local;
  }

  /** Serve more until `served` reaches `upto`, or the engine runs dry. */
  async function extend(local: LocalSession, upto: number): Promise<void> {
    while (local.served.length < upto && !local.dry) {
      const page = await api.get<SessionContinuation>('pills/compose', {
        query: {
          config: JSON.stringify(local.session.config),
          seed: local.session.seed,
          served: local.served.join(','),
          limit: Math.min(upto - local.served.length, 50),
        },
      });
      for (const pill of page.pills) {
        local.served.push(pill.id);
        local.pills[pill.id] = pill;
      }
      local.supply = page.supply;
      local.notice = page.notice ?? null;
      if (page.next_cursor === null || page.pills.length === 0) local.dry = true;
    }
  }

  async function page(sessionId: string, { cursor, limit = PAGE }: PageRequest = {}): Promise<SessionContinuation> {
    const local = await load(sessionId);
    const start = cursor === undefined || cursor === null ? local.session.position : Number(cursor);
    if (!Number.isInteger(start) || start < 0) throw new Error('Not a cursor of this session.');
    const length = local.session.config.length ?? null;
    const end = length === null ? start + limit : Math.min(start + limit, length);
    await extend(local, end);
    await save(local);
    const ids = local.served.slice(start, end);
    const reached = start + ids.length;
    const finished = length !== null && reached >= length;
    const more = !finished && ids.length > 0 && (reached < local.served.length || !local.dry);
    return {
      pills: ids.map((id) => local.pills[id]).filter((p): p is Pill => Boolean(p)),
      next_cursor: more ? String(reached) : null,
      supply: local.supply,
      done: !more,
      notice: local.notice,
    };
  }

  async function configOf(request: StartRequest): Promise<FeedConfig> {
    if ('config' in request) return request.config;
    const found = [...(await feeds()), ...(await remote.feeds().catch(() => []))].find((f) => f.id === request.feed_id);
    if (!found) throw new Error('That saved feed does not exist.');
    return found.config;
  }

  return {
    async startSession(request) {
      const session: PillSession = { id: newId(), config: await configOf(request), seed: newSeed(), position: 0, created_at: now().toISOString(), finished_at: null };
      await save({ session, served: [], pills: {}, dry: false, supply: EMPTY_SUPPLY, notice: null });
      const first = await page(session.id, { cursor: '0' });
      return { session, page: { pills: first.pills, next_cursor: first.next_cursor }, supply: first.supply, notice: first.notice };
    },

    page,

    async finish(sessionId) {
      const local = await load(sessionId);
      local.session = { ...local.session, finished_at: local.session.finished_at ?? now().toISOString() };
      await save(local);
      return summarize((await events()).filter((e) => e.session_id === sessionId));
    },

    async sendEvents(batch): Promise<EventsResult> {
      if (batch.length > MAX_EVENT_BATCH) throw new RangeError(`At most ${MAX_EVENT_BATCH} events go in one request.`);
      const kept = await events();
      const known = new Set(kept.map((e) => e.id));
      const fresh = batch.filter((e) => !known.has(e.id));
      await write(storage, LOCAL_EVENTS_KEY, [...kept, ...fresh].slice(-MAX_EVENTS));
      // A `seen` moves the session's place on, so a resume starts after it.
      const all = await sessions();
      let moved = false;
      for (const e of fresh) {
        const local = e.kind === 'seen' && e.session_id ? all[e.session_id] : undefined;
        const index = local && e.pill_id ? local.served.indexOf(e.pill_id) : -1;
        if (local && index + 1 > local.session.position) {
          local.session = { ...local.session, position: index + 1 };
          moved = true;
        }
      }
      if (moved) await write(storage, LOCAL_SESSIONS_KEY, all);
      return { accepted: fresh.length, duplicates: batch.length - fresh.length, ignored: 0 };
    },

    supply: (config) => remote.supply(config),
    generate: (request) => remote.generate(request),
    rebuild: (document) => remote.rebuild(document),
    pill: async (pillId) => {
      for (const local of Object.values(await sessions())) {
        const pill = local.pills[pillId];
        if (pill) return pill;
      }
      return remote.pill(pillId);
    },

    async feeds() {
      return [...(await feeds()), ...(await remote.feeds().catch(() => []))];
    },
    async createFeed(feed) {
      const at = now().toISOString();
      const created: Feed = { id: newId(), name: feed.name, config: feed.config, created_at: at, updated_at: at };
      await write(storage, LOCAL_FEEDS_KEY, [created, ...(await feeds())]);
      return created;
    },
    async updateFeed(feedId, patch) {
      const all = await feeds();
      const found = all.find((f) => f.id === feedId);
      if (!found) throw new Error('Only feeds saved in this browser can be changed in the demo.');
      const updated: Feed = { ...found, ...patch, updated_at: now().toISOString() };
      await write(storage, LOCAL_FEEDS_KEY, all.map((f) => (f.id === feedId ? updated : f)));
      return updated;
    },
    async deleteFeed(feedId) {
      await write(storage, LOCAL_FEEDS_KEY, (await feeds()).filter((f) => f.id !== feedId));
    },
  };
}

const RATING_PATH = /^reviews\/([^/]+)\/rating$/;

/**
 * The review API a review pill rates through, for the demo: a rating is answered here
 * (it is already kept as the pill's `answer` event); everything else goes to `api`.
 */
export function localReviewApi<A extends Pick<ApiClient, 'post'>>(api: A, now: () => Date = () => new Date()): A {
  const post = (async (path: string, body?: unknown, options?: object) => {
    const rated = RATING_PATH.exec(path);
    if (!rated) return api.post(path, body, options);
    const { rating } = (body ?? {}) as { rating: Rating };
    return { id: decodeURIComponent(rated[1] ?? ''), due: now().toISOString(), last_rating: rating } satisfies Rated;
  }) as A['post'];
  return { ...api, post };
}

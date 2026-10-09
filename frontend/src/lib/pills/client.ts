/**
 * The pills API (docs/PILLS.md §7), typed. A thin layer over the app's transport-agnostic
 * `createApiClient` (lib/api/client), so failures arrive as the same `ApiError` and a
 * mobile client only swaps `baseUrl`, `fetch` and `headers`:
 *
 *   const pills = createPillsClient({ baseUrl: '/api' });                 // web island
 *   const pills = createPillsClient({ baseUrl, fetch, headers: { 'X-API-Key': key } }); // elsewhere
 */
import { createApiClient, type ApiClient } from '../api/client';
import type {
  EventsResult,
  Feed,
  FeedConfig,
  FeedCreate,
  FeedList,
  FeedPatch,
  GenerateRequest,
  GenerateResult,
  Pill,
  PillEvent,
  RebuildResult,
  SessionContinuation,
  SessionStart,
  SessionSummary,
  StartRequest,
  Supply,
} from './types';
import { MAX_EVENT_BATCH } from './types';

export interface PillsClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
}

export interface PageRequest {
  cursor?: string | null;
  limit?: number;
}

export interface SendOptions {
  /** Let the request outlive the page (the last flush on `pagehide`). */
  keepalive?: boolean;
}

export interface PillsClient {
  /** Start a session from a config or a saved feed. */
  startSession(request: StartRequest): Promise<SessionStart>;
  /** The next page of a session; no cursor continues from its saved position. */
  page(sessionId: string, request?: PageRequest): Promise<SessionContinuation>;
  finish(sessionId: string): Promise<SessionSummary>;
  /** Up to 200 events; retries of the same ids count as duplicates. */
  sendEvents(events: readonly PillEvent[], options?: SendOptions): Promise<EventsResult>;
  supply(config: FeedConfig): Promise<Supply>;
  generate(request: GenerateRequest): Promise<GenerateResult>;
  /** Re-harvest one document, or the whole shelf when none is given. */
  rebuild(document?: string): Promise<RebuildResult>;
  pill(id: string): Promise<Pill>;
  feeds(): Promise<Feed[]>;
  createFeed(feed: FeedCreate): Promise<Feed>;
  updateFeed(id: string, patch: FeedPatch): Promise<Feed>;
  deleteFeed(id: string): Promise<void>;
}

const id = (value: string) => encodeURIComponent(value);

export function createPillsClient(options: PillsClientOptions): PillsClient {
  return pillsClientOver(createApiClient(options));
}

/** The same API over an existing client (tests, or a page that already holds one). */
export function pillsClientOver(api: Pick<ApiClient, 'get' | 'post' | 'patch' | 'delete'>): PillsClient {
  return {
    startSession: (request) => api.post<SessionStart>('pills/sessions', request),
    page: (sessionId, { cursor, limit = 10 } = {}) =>
      api.get<SessionContinuation>(`pills/sessions/${id(sessionId)}`, { query: { cursor: cursor ?? undefined, limit } }),
    finish: async (sessionId) => (await api.post<{ summary: SessionSummary }>(`pills/sessions/${id(sessionId)}/finish`)).summary,
    sendEvents: (events, { keepalive } = {}) => {
      if (events.length > MAX_EVENT_BATCH) throw new RangeError(`At most ${MAX_EVENT_BATCH} events go in one request.`);
      return api.post<EventsResult>('pills/events', { events }, keepalive ? { keepalive } : undefined);
    },
    supply: (config) => api.get<Supply>('pills/supply', { query: { config: JSON.stringify(config) } }),
    generate: (request) => api.post<GenerateResult>('pills/generate', request),
    rebuild: (document) => api.post<RebuildResult>('pills/rebuild', document ? { document } : {}),
    pill: (pillId) => api.get<Pill>(`pills/${id(pillId)}`),
    feeds: async () => (await api.get<FeedList>('pills/feeds')).items,
    createFeed: (feed) => api.post<Feed>('pills/feeds', feed),
    updateFeed: (feedId, patch) => api.patch<Feed>(`pills/feeds/${id(feedId)}`, patch),
    deleteFeed: async (feedId) => {
      await api.delete<unknown>(`pills/feeds/${id(feedId)}`);
    },
  };
}

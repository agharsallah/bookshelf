/**
 * The cited answer: `POST /search/answer` read as an event stream (`status` → `hits` →
 * `answer` | `error`), folded into one state by a pure reducer.
 */
import { toApiError } from '../../lib/api/errors';
import type {
  AnswerError,
  AnswerPayload,
  AnswerStatus,
  SearchRequest,
  SearchResponse,
} from '../../lib/api/types/search';
import { eventJson, readEventStream, type SseEvent } from './sse';

export const ANSWER_PATH = '/api/search/answer';

export interface AnswerFailure extends AnswerError {
  requestId: string | null;
}

export type AnswerState =
  | { phase: 'idle' }
  | { phase: 'streaming'; question: string; status: AnswerStatus | null; hits: SearchResponse | null }
  | { phase: 'done'; question: string; hits: SearchResponse | null; answer: AnswerPayload }
  | { phase: 'error'; question: string; hits: SearchResponse | null; error: AnswerFailure }
  | { phase: 'cancelled'; question: string; hits: SearchResponse | null };

export type AnswerAction =
  | { type: 'start'; question: string }
  | { type: 'event'; event: SseEvent; requestId: string | null }
  | { type: 'fail'; error: AnswerFailure }
  | { type: 'cancel' }
  | { type: 'reset' };

export const idleAnswer: AnswerState = { phase: 'idle' };

function malformed(requestId: string | null): AnswerFailure {
  return { code: 'bad_stream', message: 'The answer stream sent something unreadable.', requestId };
}

export function answerReducer(state: AnswerState, action: AnswerAction): AnswerState {
  switch (action.type) {
    case 'start':
      return { phase: 'streaming', question: action.question, status: null, hits: null };
    case 'reset':
      return idleAnswer;
    case 'cancel':
      return state.phase === 'streaming' ? { phase: 'cancelled', question: state.question, hits: state.hits } : state;
    case 'fail':
      return state.phase === 'streaming' ? { phase: 'error', question: state.question, hits: state.hits, error: action.error } : state;
    case 'event':
      return state.phase === 'streaming' ? onEvent(state, action.event, action.requestId) : state;
  }
}

type Streaming = Extract<AnswerState, { phase: 'streaming' }>;

function onEvent(state: Streaming, event: SseEvent, requestId: string | null): AnswerState {
  const { question, hits } = state;
  switch (event.event) {
    case 'status': {
      const status = eventJson<AnswerStatus>(event);
      return status ? { ...state, status } : state;
    }
    case 'hits': {
      const next = eventJson<SearchResponse>(event);
      return next ? { ...state, hits: next } : state;
    }
    case 'answer': {
      const answer = eventJson<AnswerPayload>(event);
      if (!answer || !Array.isArray(answer.blocks)) return { phase: 'error', question, hits, error: malformed(requestId) };
      return { phase: 'done', question, hits, answer: { ...answer, sources: answer.sources ?? {} } };
    }
    case 'error': {
      const error = eventJson<AnswerError>(event);
      return {
        phase: 'error',
        question,
        hits,
        error: error ? { code: error.code, message: error.message, requestId } : malformed(requestId),
      };
    }
    default:
      return state;
  }
}

export interface StreamAnswerOptions {
  request: SearchRequest;
  signal: AbortSignal;
  onEvent: (event: SseEvent, requestId: string | null) => void;
  fetch?: typeof fetch;
}

/**
 * Open the stream and forward frames until it ends. HTTP failures (401, 422, 502…)
 * throw an `ApiError` carrying the request id; an abort rejects with `AbortError`.
 */
export async function streamAnswer({ request, signal, onEvent, fetch: doFetch = fetch }: StreamAnswerOptions): Promise<void> {
  let response: Response;
  try {
    response = await doFetch(ANSWER_PATH, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw toApiError(0, undefined);
  }
  const requestId = response.headers.get('x-request-id');
  if (!response.ok || !response.body) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    throw toApiError(response.status, body, requestId);
  }
  await readEventStream(response.body, (event) => onEvent(event, requestId));
}

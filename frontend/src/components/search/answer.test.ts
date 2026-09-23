import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api/errors';
import { answerReducer, idleAnswer, streamAnswer, type AnswerState } from './answer';
import type { SseEvent } from '../../lib/sse';

const ev = (event: string, data: unknown): SseEvent => ({ event, data: JSON.stringify(data), id: null });
const hits = { intent: 'discovery', groups: [], took_ms: 3 };
const answer = { blocks: [{ type: 'paragraph', spans: [{ text: 'Delays', cites: ['m:ch01'] }] }], sources: {}, dropped_cites: [], model: 'x' };

function run(events: SseEvent[]): AnswerState {
  return events.reduce(
    (s, event) => answerReducer(s, { type: 'event', event, requestId: 'r1' }),
    answerReducer(idleAnswer, { type: 'start', question: 'why delays?' }),
  );
}

describe('answerReducer', () => {
  it('shows status, then keeps the hits, then lands on the answer', () => {
    const writing = run([ev('status', { stage: 'routing', message: 'Reading' }), ev('hits', hits), ev('status', { stage: 'writing', message: 'Writing' })]);
    expect(writing).toMatchObject({ phase: 'streaming', status: { stage: 'writing' }, hits });
    expect(run([ev('hits', hits), ev('answer', answer)])).toEqual({ phase: 'done', question: 'why delays?', hits, answer });
  });

  it('turns an error event into an error carrying the request id', () => {
    expect(run([ev('error', { code: 'no_evidence', message: 'Nothing matches.' })])).toMatchObject({
      phase: 'error',
      error: { code: 'no_evidence', message: 'Nothing matches.', requestId: 'r1' },
    });
  });

  it('treats an unreadable answer as an error', () => {
    expect(run([{ event: 'answer', data: '{nope', id: null }])).toMatchObject({ phase: 'error', error: { code: 'bad_stream' } });
  });

  it('ignores events after a cancel and a late failure after the answer', () => {
    const cancelled = answerReducer(run([ev('hits', hits)]), { type: 'cancel' });
    const late = answerReducer(cancelled, { type: 'event', event: ev('answer', answer), requestId: null });
    const done = run([ev('answer', answer)]);
    const failedLate = answerReducer(done, { type: 'fail', error: { code: 'x', message: 'y', requestId: null } });
    expect([late.phase, failedLate]).toEqual(['cancelled', done]);
  });
});

describe('streamAnswer', () => {
  const request = { query: 'why delays?' };

  it('posts the question and forwards frames with the response request id', async () => {
    const sent: RequestInit[] = [];
    const fake: typeof fetch = async (_url, init) => {
      sent.push(init ?? {});
      return new Response('event: status\ndata: {"stage":"routing","message":"m"}\n\n', {
        headers: { 'content-type': 'text/event-stream', 'x-request-id': 'abc' },
      });
    };
    const got: [string, string | null][] = [];
    await streamAnswer({ request, signal: new AbortController().signal, fetch: fake, onEvent: (e, id) => got.push([e.event, id]) });
    expect([sent[0]?.method, sent[0]?.body, got]).toEqual(['POST', JSON.stringify(request), [['status', 'abc']]]);
  });

  it('throws the API error envelope for a refused request', async () => {
    const fake: typeof fetch = async () =>
      Response.json({ error: { code: 'unauthorized', message: 'Key required.', details: [], request_id: 'rid' } }, { status: 401 });
    const failure = streamAnswer({ request, signal: new AbortController().signal, fetch: fake, onEvent: () => undefined });
    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ code: 'unauthorized', requestId: 'rid' });
  });
});

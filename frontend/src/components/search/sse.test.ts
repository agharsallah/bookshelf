import { describe, expect, it } from 'vitest';
import { createSseParser, readEventStream, type SseEvent } from './sse';

const STREAM =
  'event: status\ndata: {"stage":"routing"}\n\n' +
  ': keep-alive\n\n' +
  'event: hits\ndata: {"a":1}\ndata: {"b":2}\nid: 7\n\n' +
  'data: plain\n\n';

const EXPECTED: SseEvent[] = [
  { event: 'status', data: '{"stage":"routing"}', id: null },
  { event: 'hits', data: '{"a":1}\n{"b":2}', id: '7' },
  { event: 'message', data: 'plain', id: '7' },
];

function feed(chunks: string[]): SseEvent[] {
  const parser = createSseParser();
  return [...chunks.flatMap((c) => parser.push(c)), ...parser.end()];
}

describe('createSseParser', () => {
  it('parses named events, multi-line data, comments, ids and the default event name', () => {
    expect(feed([STREAM])).toEqual(EXPECTED);
  });

  it('gives the same events however the stream is split into chunks', () => {
    const everySplit = Array.from({ length: STREAM.length - 1 }, (_, i) => feed([STREAM.slice(0, i + 1), STREAM.slice(i + 1)]));
    expect(everySplit.every((events) => JSON.stringify(events) === JSON.stringify(EXPECTED))).toBe(true);
    expect(feed([...STREAM])).toEqual(EXPECTED);
  });

  it('accepts CRLF and lone CR line endings, even when a CRLF straddles two chunks', () => {
    expect(feed(['event: a\r\ndata: 1\r', '\n\r\n', 'data: 2\r\r'])).toEqual([
      { event: 'a', data: '1', id: null },
      { event: 'message', data: '2', id: null },
    ]);
  });

  it('strips exactly one space after the colon and keeps the rest', () => {
    expect(feed(['data:  two spaces\ndata:none\n\n'])).toEqual([{ event: 'message', data: ' two spaces\nnone', id: null }]);
  });

  it('drops a trailing frame that never got its blank line', () => {
    expect(feed(['event: answer\ndata: {"half":'])).toEqual([]);
  });

  it('ignores a frame that has an event name but no data', () => {
    expect(feed(['event: ping\n\n'])).toEqual([]);
  });
});

describe('readEventStream', () => {
  it('decodes multi-byte characters split across byte chunks', async () => {
    const bytes = new TextEncoder().encode('data: café ¶\n\n');
    const split = bytes.indexOf(0xc3) + 1; // inside the two-byte "é"
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    const events: SseEvent[] = [];
    await readEventStream(body, (e) => events.push(e));
    expect(events).toEqual([{ event: 'message', data: 'café ¶', id: null }]);
  });
});

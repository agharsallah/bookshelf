/**
 * A small Server-Sent Events frame parser (WHATWG "event stream interpretation").
 *
 * `EventSource` cannot POST, so the cited-answer stream is read with `fetch` and fed
 * through this parser chunk by chunk. Chunks may split anywhere: inside a field name,
 * between `\r` and `\n`, or in the middle of a multi-byte character (the decoder in
 * `readEventStream` handles the last one).
 */

export interface SseEvent {
  /** `message` when the frame names no event. */
  event: string;
  data: string;
  id: string | null;
}

export interface SseParser {
  /** Feed decoded text; returns the events completed by it. */
  push(chunk: string): SseEvent[];
  /** End of stream: a trailing frame without its blank line is discarded, per spec. */
  end(): SseEvent[];
}

export function createSseParser(): SseParser {
  let buffer = '';
  let pendingCr = false;
  let event = '';
  let data: string[] = [];
  let lastId: string | null = null;

  function dispatch(out: SseEvent[]) {
    if (data.length > 0) out.push({ event: event || 'message', data: data.join('\n'), id: lastId });
    event = '';
    data = [];
  }

  function line(text: string, out: SseEvent[]) {
    if (text === '') return dispatch(out);
    if (text.startsWith(':')) return;
    const colon = text.indexOf(':');
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? '' : text.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    else if (field === 'id' && !value.includes('\0')) lastId = value;
  }

  return {
    push(chunk) {
      const out: SseEvent[] = [];
      let text = chunk;
      // A `\r` that ended the previous chunk already closed its line; skip its `\n`.
      if (pendingCr && text.startsWith('\n')) text = text.slice(1);
      pendingCr = false;
      buffer += text;
      let start = 0;
      for (let i = 0; i < buffer.length; i += 1) {
        const ch = buffer[i];
        if (ch !== '\n' && ch !== '\r') continue;
        line(buffer.slice(start, i), out);
        if (ch === '\r') {
          if (i + 1 === buffer.length) pendingCr = true;
          else if (buffer[i + 1] === '\n') i += 1;
        }
        start = i + 1;
      }
      buffer = buffer.slice(start);
      return out;
    },
    end() {
      buffer = '';
      event = '';
      data = [];
      return [];
    },
  };
}

/** Parse a JSON `data` field, or null when it is not JSON. */
export function eventJson<T>(event: SseEvent): T | null {
  try {
    return JSON.parse(event.data) as T;
  } catch {
    return null;
  }
}

/** Read a response body as an event stream, calling `onEvent` per frame. */
export async function readEventStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
): Promise<void> {
  const parser = createSseParser();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true })).forEach(onEvent);
    }
    parser.push(decoder.decode()).forEach(onEvent);
    parser.end();
  } finally {
    reader.releaseLock();
  }
}

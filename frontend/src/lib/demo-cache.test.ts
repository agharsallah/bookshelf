import { describe, expect, it } from 'vitest';
import { demoCacheable } from './demo-cache';

const request = (method = 'GET', accept = 'text/html') => new Request('https://demo.example/map', { method, headers: { accept } });

describe('demoCacheable', () => {
  it('caches reads of pages and API answers', () => {
    expect(demoCacheable(request())).toBe(true);
    expect(demoCacheable(request('get', 'application/json'))).toBe(true);
  });

  it('leaves writes and live streams alone', () => {
    expect(demoCacheable(request('POST'))).toBe(false);
    expect(demoCacheable(request('GET', 'text/event-stream'))).toBe(false);
  });
});

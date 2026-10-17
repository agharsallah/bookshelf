import { describe, expect, it } from 'vitest';
import { DEMO_CDN_CACHE_CONTROL, demoCdnCacheControl } from './demo-cache';

const response = (status = 200, headers: Record<string, string> = { 'content-type': 'text/html' }) => new Response(null, { status, headers });

describe('demoCdnCacheControl', () => {
  it('lets the CDN keep a successful read', () => {
    expect(demoCdnCacheControl('GET', response())).toBe(DEMO_CDN_CACHE_CONTROL);
    expect(demoCdnCacheControl('get', response(200, { 'content-type': 'application/json' }))).toBe(DEMO_CDN_CACHE_CONTROL);
  });

  it('leaves writes, failures, cookies and streams uncached', () => {
    expect(demoCdnCacheControl('POST', response())).toBeNull();
    expect(demoCdnCacheControl('GET', response(404))).toBeNull();
    expect(demoCdnCacheControl('GET', response(502))).toBeNull();
    expect(demoCdnCacheControl('GET', response(200, { 'content-type': 'text/html', 'set-cookie': 'a=1' }))).toBeNull();
    expect(demoCdnCacheControl('GET', response(200, { 'content-type': 'text/event-stream' }))).toBeNull();
  });
});

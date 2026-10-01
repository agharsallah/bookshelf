import { describe, expect, it } from 'vitest';
import { isPrefetch, PREFETCH_MAX_AGE_SECONDS, prefetchCacheControl } from './prefetch-cache';

const html = (init: ResponseInit = {}) =>
  new Response('<html></html>', { status: 200, ...init, headers: { 'content-type': 'text/html; charset=utf-8', ...init.headers } });

describe('isPrefetch', () => {
  it.each([
    [{ 'sec-purpose': 'prefetch' }, true],
    [{ 'sec-purpose': 'prefetch;prerender' }, true],
    [{ purpose: 'prefetch' }, true],
    [{ 'sec-purpose': 'prerender' }, false],
    [{}, false],
  ])('%o → %s', (headers, expected) => {
    expect(isPrefetch(new Headers(headers))).toBe(expected);
  });
});

describe('prefetchCacheControl', () => {
  const prefetch = new Headers({ 'sec-purpose': 'prefetch' });

  it('keeps a prefetched page briefly, for this browser only', () => {
    expect(prefetchCacheControl(prefetch, html())).toBe(`private, max-age=${PREFETCH_MAX_AGE_SECONDS}`);
  });

  it('leaves ordinary page requests uncached', () => {
    expect(prefetchCacheControl(new Headers(), html())).toBeNull();
  });

  it('does not keep a failed page', () => {
    expect(prefetchCacheControl(prefetch, html({ status: 404 }))).toBeNull();
    expect(prefetchCacheControl(prefetch, html({ status: 500 }))).toBeNull();
  });

  it('respects a page that set its own caching', () => {
    expect(prefetchCacheControl(prefetch, html({ headers: { 'cache-control': 'no-store' } }))).toBeNull();
  });

  it('only applies to HTML pages', () => {
    const json = new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    expect(prefetchCacheControl(prefetch, json)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { TODAY_CACHE_TAG, staleTagsAfter } from './route-cache';

describe('staleTagsAfter', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('drops the cached Today after a %s', (method) => {
    expect(staleTagsAfter(method)).toEqual([TODAY_CACHE_TAG]);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('keeps the cache on a %s', (method) => {
    expect(staleTagsAfter(method)).toEqual([]);
  });
});


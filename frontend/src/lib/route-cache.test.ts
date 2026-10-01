import { describe, expect, it } from 'vitest';
import { DESK_CACHE_TAG, staleTagsAfter } from './route-cache';

describe('staleTagsAfter', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post'])('drops the cached Desk after a %s', (method) => {
    expect(staleTagsAfter(method)).toEqual([DESK_CACHE_TAG]);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])('keeps the cache on a %s', (method) => {
    expect(staleTagsAfter(method)).toEqual([]);
  });
});


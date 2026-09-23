import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { describeHealth } from './health';

const live = { status: 'ok', version: '0.1.0', environment: 'local' };

describe('describeHealth', () => {
  it('reports a ready backend with its version and environment', () => {
    expect(describeHealth(live, { status: 'ready', database: 'ok', qdrant: 'ok', qdrant_error: null })).toEqual({
      state: 'up',
      message: 'API connected (v0.1.0, local)',
    });
  });

  it('reports Qdrant being down as degraded, with the reason', () => {
    expect(describeHealth(live, { status: 'degraded', database: 'ok', qdrant: 'unavailable', qdrant_error: 'connection refused' })).toEqual({
      state: 'degraded',
      message: 'API connected (v0.1.0, local); meaning-based search is off (Qdrant unavailable).',
      detail: 'connection refused',
    });
  });

  it('reports a database outage (503 on readiness) as down', () => {
    const notReady = new ApiError({ status: 503, code: 'not_ready', message: 'Database is unavailable.' });
    expect(describeHealth(live, notReady)).toMatchObject({ state: 'down', detail: 'Database is unavailable.' });
  });

  it('reports an unreachable backend', () => {
    const error = new ApiError({ status: 502, code: 'upstream_unavailable', message: 'x' });
    expect(describeHealth(error)).toEqual({ state: 'down', message: 'API unreachable. Check that the backend is running.' });
  });
});

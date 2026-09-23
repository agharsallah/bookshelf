import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { describeHealth } from './health';

describe('describeHealth', () => {
  it('reports a healthy backend with its version and environment', () => {
    expect(describeHealth({ status: 'ok', version: '0.1.0', environment: 'local' })).toEqual({
      state: 'up',
      message: 'API connected (v0.1.0, local)',
    });
  });

  it('reports an unreachable backend', () => {
    const error = new ApiError({ status: 502, code: 'upstream_unavailable', message: 'x' });
    expect(describeHealth(error).state).toBe('down');
  });
});

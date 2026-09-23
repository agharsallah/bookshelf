import { describe, expect, it } from 'vitest';
import { ApiError, toApiError } from './errors';

describe('toApiError', () => {
  it('reads code, message, details and request id from the backend envelope', () => {
    const error = toApiError(422, {
      error: {
        code: 'validation_error',
        message: 'Request is invalid.',
        details: [{ loc: ['body', 'path'], msg: 'required' }],
        request_id: 'abc123',
      },
    });
    expect(error).toBeInstanceOf(ApiError);
    expect({ ...error, message: error.message }).toMatchObject({
      status: 422,
      code: 'validation_error',
      message: 'Request is invalid.',
      details: [{ loc: ['body', 'path'], msg: 'required' }],
      requestId: 'abc123',
    });
  });

  it('falls back to the header request id when the body lacks one', () => {
    const error = toApiError(404, { error: { code: 'not_found', message: 'Gone.' } }, 'hdr-1');
    expect([error.code, error.details, error.requestId]).toEqual(['not_found', [], 'hdr-1']);
  });

  it('gives non-envelope bodies a status-derived code', () => {
    const error = toApiError(502, '<html>Bad gateway</html>');
    expect([error.code, error.message]).toEqual(['http_502', 'The API answered 502.']);
  });

  it('reports an unreachable API as a network error', () => {
    expect(toApiError(0, undefined).code).toBe('network_error');
  });
});

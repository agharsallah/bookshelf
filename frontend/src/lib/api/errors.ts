/**
 * The backend's single error shape:
 * `{ error: { code, message, details, request_id } }` (backend/app/schemas/common.py).
 */

export type ErrorDetail = Record<string, unknown>;

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details: ErrorDetail[];
    request_id: string;
  };
}

/** A failed API call. `code` is stable and machine-readable; branch on it, not on `message`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ErrorDetail[];
  readonly requestId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetail[];
    requestId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Type guard for the backend error envelope. */
export function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
  if (!isRecord(body) || !isRecord(body.error)) return false;
  const { code, message } = body.error;
  return typeof code === 'string' && typeof message === 'string';
}

/**
 * Build an `ApiError` from a failed response body. Bodies that are not an envelope
 * (a proxy's HTML 502, an empty body) still yield a typed error with a generic code.
 */
export function toApiError(
  status: number,
  body: unknown,
  headerRequestId: string | null = null,
): ApiError {
  if (isErrorEnvelope(body)) {
    const { code, message, details, request_id } = body.error;
    return new ApiError({
      status,
      code,
      message,
      details: Array.isArray(details) ? details.filter(isRecord) : [],
      requestId: typeof request_id === 'string' ? request_id : headerRequestId,
    });
  }
  return new ApiError({
    status,
    code: status === 0 ? 'network_error' : `http_${status}`,
    message: status === 0 ? 'The API could not be reached.' : `The API answered ${status}.`,
    requestId: headerRequestId,
  });
}

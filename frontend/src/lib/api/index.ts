/** Browser-safe API surface. Server code imports `./server` for `serverApi()`. */
export { ApiError, toApiError, isErrorEnvelope, type ErrorEnvelope } from './errors';
export { browserApi, buildUrl, createApiClient, type ApiClient, type Query } from './client';
export type { Health, Page } from './types';

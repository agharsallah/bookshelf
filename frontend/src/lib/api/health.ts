/**
 * Human wording for the footer API indicator, from `GET /health` (liveness, version)
 * and `GET /health/ready` (database and Qdrant). Qdrant down is `degraded`, not down:
 * only meaning-based search needs it.
 */
import { ApiError } from './errors';
import type { Health, Readiness } from './types';

export interface HealthStatus {
  state: 'up' | 'degraded' | 'down';
  message: string;
  /** The underlying reason, for a tooltip (e.g. Qdrant's connection error). */
  detail?: string;
}

function unreachable(error: ApiError): HealthStatus {
  return {
    state: 'down',
    message:
      error.code === 'upstream_unavailable' || error.code === 'network_error'
        ? 'API unreachable. Check that the backend is running.'
        : `API error: ${error.message}`,
  };
}

/** `ready` is the readiness body, or the error its request threw (a 503 when the database is down). */
export function describeHealth(health: unknown, ready?: unknown): HealthStatus {
  if (health instanceof ApiError) return unreachable(health);
  const live = health as Partial<Health> | null;
  if (!live || live.status !== 'ok') return { state: 'down', message: 'API unavailable.' };
  const version = [live.version && `v${live.version}`, live.environment].filter(Boolean).join(', ');
  const connected = version ? `API connected (${version})` : 'API connected';

  if (ready instanceof ApiError) {
    return ready.status === 503 ? { state: 'down', message: `${connected}, but its database is unavailable.`, detail: ready.message } : unreachable(ready);
  }
  const readiness = ready as Partial<Readiness> | null | undefined;
  if (readiness?.status === 'degraded') {
    return {
      state: 'degraded',
      message: `${connected}; meaning-based search is off (Qdrant unavailable).`,
      detail: readiness.qdrant_error ?? undefined,
    };
  }
  return { state: 'up', message: connected };
}

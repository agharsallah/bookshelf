/** Human wording for the footer API indicator. */
import { ApiError } from './errors';
import type { Health } from './types';

export interface HealthStatus {
  state: 'up' | 'down';
  message: string;
}

export function describeHealth(result: unknown): HealthStatus {
  if (result instanceof ApiError) {
    return {
      state: 'down',
      message:
        result.code === 'upstream_unavailable' || result.code === 'network_error'
          ? 'API unreachable. Check that the backend is running.'
          : `API error: ${result.message}`,
    };
  }
  const health = result as Partial<Health> | null;
  if (health && health.status === 'ok') {
    const detail = [health.version && `v${health.version}`, health.environment].filter(Boolean).join(', ');
    return { state: 'up', message: detail ? `API connected (${detail})` : 'API connected' };
  }
  return { state: 'down', message: 'API unavailable.' };
}

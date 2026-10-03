/**
 * Follow a build while the server works on it: ask `GET /builds/{id}` again `pollMs` after
 * each answer for as long as it is planning, building or stopping, and stop once it is not.
 * A failed poll is tried again after the same pause.
 */
import { useEffect, useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildPublic } from '../../lib/api/types/builds';
import { getBuild } from '../../lib/builds/api';
import { isActive } from '../../lib/builds/state';

export const POLL_MS = 3000;

export function usePolledBuild(api: Pick<ApiClient, 'get'>, build: BuildPublic, onChange: (build: BuildPublic) => void, pollMs = POLL_MS): void {
  const [misses, setMisses] = useState(0);
  const active = isActive(build.state);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const timer = setTimeout(() => {
      getBuild(api, build.id).then(
        (next) => {
          if (live) onChange(next);
        },
        () => {
          if (live) setMisses((n) => n + 1);
        },
      );
    }, pollMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, build, active, onChange, pollMs, misses]);
}

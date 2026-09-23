/** The current time, re-read every `intervalMs` while `active` (for live elapsed times). */
import { useEffect, useState } from 'react';

export function useNow(active: boolean, intervalMs = 1000, initial: number = Date.now()): number {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}

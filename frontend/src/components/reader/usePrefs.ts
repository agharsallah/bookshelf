/**
 * `useReaderPrefs` — the reader preferences as React state backed by localStorage.
 * The server renders the defaults; the stored preferences apply on hydration, and
 * a change in another tab follows here through the `storage` event.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_PREFS, parsePrefs, PREFS_STORAGE_KEY, type ReaderPrefs } from './prefs';

const listeners = new Set<() => void>();
let cached: { raw: string | null; prefs: ReaderPrefs } | null = null;
/** Used when storage is blocked, so choices still apply for this page. */
let fallback: string | null = null;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFS_STORAGE_KEY);
  } catch {
    return fallback;
  }
}

function snapshot(): ReaderPrefs {
  const raw = readRaw();
  if (cached?.raw !== raw) cached = { raw, prefs: parsePrefs(raw) };
  return cached.prefs;
}

const serverSnapshot = (): ReaderPrefs => DEFAULT_PREFS;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === PREFS_STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function writePrefs(prefs: ReaderPrefs): void {
  const raw = JSON.stringify(prefs);
  fallback = raw;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, raw);
  } catch {
    // Storage blocked: keep the in-memory copy.
  }
  listeners.forEach((l) => l());
}

export type PrefsUpdate = Partial<ReaderPrefs> | ((prefs: ReaderPrefs) => Partial<ReaderPrefs>);

export function useReaderPrefs(): [ReaderPrefs, (update: PrefsUpdate) => void] {
  const prefs = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const update = useCallback((change: PrefsUpdate) => {
    const current = snapshot();
    writePrefs({ ...current, ...(typeof change === 'function' ? change(current) : change) });
  }, []);
  return [prefs, update];
}

/**
 * Where the pills client keeps what must survive a reload (the unsent event queue).
 * Asynchronous so a mobile client can hand in AsyncStorage as-is; the web passes
 * `localStorageAdapter()`. Every adapter swallows its own failures (private mode, a full
 * quota, blocked storage): losing a persisted copy must never break the feed.
 */

export interface StorageAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Kept in memory only: tests, and the fallback where nothing persists. */
export function memoryStorage(seed: Record<string, string> = {}): StorageAdapter & { snapshot(): Record<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
    snapshot: () => Object.fromEntries(data),
  };
}

/** The slice of the Web Storage API the adapter uses. */
export type WebStorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Over `localStorage` (or any Web Storage). The store is looked up on each call, so an
 * adapter made on the server, or where reading `localStorage` throws, is still safe.
 */
export function localStorageAdapter(store: () => WebStorageLike | undefined = () => globalThis.localStorage): StorageAdapter {
  const attempt = <T>(run: (s: WebStorageLike) => T, fallback: T): T => {
    try {
      const s = store();
      return s ? run(s) : fallback;
    } catch {
      return fallback;
    }
  };
  return {
    get: async (key) => attempt((s) => s.getItem(key), null),
    set: async (key, value) => attempt((s) => s.setItem(key, value), undefined),
    remove: async (key) => attempt((s) => s.removeItem(key), undefined),
  };
}

/** Read JSON, or `fallback` when it is missing or unreadable. */
export async function readJson<T>(storage: StorageAdapter, key: string, fallback: T): Promise<T> {
  try {
    const raw = await storage.get(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export async function writeJson(storage: StorageAdapter, key: string, value: unknown): Promise<void> {
  try {
    await storage.set(key, JSON.stringify(value));
  } catch {
    // Best-effort, like every persisted copy here.
  }
}

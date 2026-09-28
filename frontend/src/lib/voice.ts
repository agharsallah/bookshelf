/**
 * The reader's default voice, kept in localStorage like the other display choices. Narration
 * forms cast it first when the language allows; blocked storage simply means no preference.
 */

export const VOICE_STORAGE_KEY = 'bookshelf:voice';

export function readVoice(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string | null {
  try {
    return storage?.getItem(VOICE_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** Remember the voice (null forgets it); false when storage refused. */
export function saveVoice(voice: string | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()): boolean {
  try {
    if (!storage) return false;
    if (voice) storage.setItem(VOICE_STORAGE_KEY, voice);
    else storage.removeItem(VOICE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

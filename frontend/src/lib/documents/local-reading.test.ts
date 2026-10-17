import { describe, expect, it } from 'vitest';
import type { ReadingPosition } from '../api/types/documents';
import { localReading, mergePositions, saveLocalPosition, setLocalFinished } from './local-reading';

function memory(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const at = (iso: string) => () => new Date(iso);
const position = (unit: string, progress: number, updated_at: string, anchor = `${unit}/p001`): ReadingPosition => ({ unit, anchor, progress, updated_at });

describe('local reading', () => {
  it('keeps the place per chapter and never moves progress back', () => {
    const storage = memory();
    saveLocalPosition('meadows', { unit: 'ch01', anchor: 'ch01/p010', progress: 0.6 }, { storage, now: at('2026-10-17T10:00:00Z') });
    saveLocalPosition('meadows', { unit: 'ch01', anchor: 'ch01/p004', progress: 0.2 }, { storage, now: at('2026-10-17T10:05:00Z') });

    expect(localReading('meadows', { storage }).positions).toEqual([position('ch01', 0.6, '2026-10-17T10:05:00.000Z', 'ch01/p004')]);
    expect(localReading('other', { storage })).toEqual({ positions: [], finished_at: null });
  });

  it('marks and unmarks a document finished', () => {
    const storage = memory();
    setLocalFinished('meadows', true, { storage, now: at('2026-10-17T10:00:00Z') });
    expect(localReading('meadows', { storage }).finished_at).toBe('2026-10-17T10:00:00.000Z');
    setLocalFinished('meadows', false, { storage });
    expect(localReading('meadows', { storage }).finished_at).toBeNull();
  });

  it('survives a corrupt store', () => {
    const storage = memory();
    storage.setItem('bookshelf:demo:reading', '{not json');
    expect(localReading('meadows', { storage }).positions).toEqual([]);
  });

  it('merges the browser over the server: newer place, furthest progress', () => {
    const server = [position('ch01', 0.9, '2026-10-01T00:00:00Z'), position('ch02', 0.3, '2026-10-01T00:00:00Z')];
    const local = [position('ch01', 0.4, '2026-10-17T00:00:00Z', 'ch01/p020'), position('ch03', 1, '2026-10-17T00:00:00Z')];

    const merged = Object.fromEntries(mergePositions(server, local).map((p) => [p.unit, p]));
    expect(merged.ch01).toEqual({ unit: 'ch01', anchor: 'ch01/p020', progress: 0.9, updated_at: '2026-10-17T00:00:00Z' });
    expect(merged.ch02?.progress).toBe(0.3);
    expect(merged.ch03?.progress).toBe(1);
  });
});

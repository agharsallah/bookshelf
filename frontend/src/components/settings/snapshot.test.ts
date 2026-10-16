import { describe, expect, it } from 'vitest';
import { latestLine, progressLine, progressShare, restoreBlocker } from './snapshot';
import { idleSnapshot, snapshotStatus } from './testing';

const NOW = Date.parse('2026-10-16T12:00:00Z');

describe('snapshot', () => {
  it('sums up the last snapshot in a line', () => {
    const file = { name: 'bookshelf-x.tar.gz', size_bytes: 432_340_000, created_at: '2026-10-16T10:00:00Z', documents: 42, files: 1830 };

    expect(latestLine(file, NOW)).toBe('Made 2 h ago · 412.3 MB · 42 documents, 1,830 files');
  });

  it('measures progress only once there is something to count', () => {
    expect(progressShare({ ...idleSnapshot, state: 'running', step: 'Starting' })).toBeNull();
    expect(progressShare({ ...idleSnapshot, state: 'running', done: 30, total: 120 })).toBe(0.25);
    expect(progressShare({ ...idleSnapshot, state: 'done', done: 120, total: 120 })).toBeNull();
  });

  it('says how a restore ended, and that a failure before the rows left things alone', () => {
    const restore = { ...idleSnapshot, action: 'restore' as const };

    expect(progressLine({ ...restore, state: 'done', rows: 5120 }, 'Supabase')).toBe(
      'Restored 5,120 rows into Supabase. Search is being rebuilt in the queue.',
    );
    expect(progressLine({ ...restore, state: 'failed', error: 'This is not a Bookshelf snapshot.' }, 'Supabase')).toMatch(
      /^The restore failed: This is not a Bookshelf snapshot\. If it failed before the rows were replaced, Supabase and its files are as they were\.$/,
    );
    expect(progressLine({ ...idleSnapshot, action: 'export', state: 'running', step: 'Packing media/a.png', done: 3, total: 1200 }, 'x')).toBe(
      'Packing media/a.png (3 of 1,200)',
    );
    expect(progressLine(idleSnapshot, 'x')).toBe('');
  });

  it('refuses files a restore would not accept, before uploading them', () => {
    const status = snapshotStatus({ max_bytes: 1000 });

    expect(restoreBlocker(status, { name: 'shelf.tar.gz', size: 999 })).toBeNull();
    expect(restoreBlocker(status, { name: 'shelf.zip', size: 10 })).toMatch(/\.tar\.gz file/);
    expect(restoreBlocker(status, { name: 'shelf.tar.gz', size: 1001 })).toMatch(/larger than the 1000 B/);
    expect(restoreBlocker(snapshotStatus({ progress: { ...idleSnapshot, state: 'running' } }), { name: 'a.tar.gz', size: 1 })).toMatch(/being made or restored/);
  });
});

import { describe, expect, it } from 'vitest';
import { countsLine, lastChangeLine, newer, overwriteWarning, progressShare, switchBlocker, syncBlocker, syncLine, syncVerb } from './database';
import { counts, dbStatus, idleSync } from './testing';

const labelOf = (t: 'local' | 'remote') => (t === 'local' ? 'This computer' : 'Supabase');

describe('what a database holds', () => {
  it('counts in words, singular and plural', () => {
    expect(countsLine(counts({ documents: 1, notes: 1200, artifacts: 0, collections: 3 }))).toBe(
      '1 document · 1,200 notes · 0 study items · 3 collections',
    );
  });

  it('says when it last changed, or that nothing was written', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    expect(lastChangeLine(counts(), now)).toBe('Last change 2 h ago');
    expect(lastChangeLine(counts({ last_change: null }), now)).toBe('Nothing written yet');
  });

  it('names the one written to last', () => {
    expect(newer(dbStatus({}, { counts: counts({ last_change: '2026-10-02T00:00:00Z' }) }))).toBe('local');
    expect(newer(dbStatus({}, {}, { counts: counts({ last_change: '2026-10-02T00:00:00Z' }) }))).toBe('remote');
    expect(newer(dbStatus())).toBeNull(); // same time
    expect(newer(dbStatus({}, { counts: counts({ last_change: null }) }))).toBeNull();
  });
});

describe('what stops a switch', () => {
  it('allows a healthy database', () => {
    expect(switchBlocker(dbStatus(), 'local')).toBeNull();
  });

  it('refuses one that cannot be reached, with the reason', () => {
    const down = dbStatus({}, { reachable: false, error: 'connection refused', counts: null });
    expect(switchBlocker(down, 'local')).toBe('This computer cannot be reached: connection refused');
  });

  it('refuses while syncing, with different schemas, or with one database', () => {
    expect(switchBlocker(dbStatus({ sync: { ...idleSync, state: 'running' } }), 'local')).toBe('A sync is running.');
    expect(switchBlocker(dbStatus({ schema_problems: ['table x is missing'] }), 'local')).toMatch(/different schemas/);
    expect(switchBlocker(dbStatus({ available: false }), 'local')).toMatch(/Only one/);
  });
});

describe('what stops a sync', () => {
  it('waits for running jobs on either side', () => {
    const busy = dbStatus({}, {}, { counts: counts({ running_jobs: 2 }) });
    expect(syncBlocker(busy, 'local')).toBe('2 jobs are running on Supabase. Sync once they finish.');
    expect(syncBlocker(busy, 'remote')).toBe('2 jobs are running on Supabase. Sync once they finish.');
  });

  it('needs both sides reachable', () => {
    const down = dbStatus({}, {}, { reachable: false, error: null, counts: null });
    expect(syncBlocker(down, 'local')).toBe('Supabase cannot be reached.');
  });

  it('allows it otherwise', () => {
    expect(syncBlocker(dbStatus(), 'remote')).toBeNull();
  });
});

describe('the sync in words', () => {
  it('warns before replacing the newer side', () => {
    const remoteNewer = dbStatus({}, {}, { counts: counts({ last_change: '2026-10-02T00:00:00Z' }) });
    expect(overwriteWarning(remoteNewer, 'local')).toBe('Supabase changed more recently than This computer. Whatever is only there will be lost.');
    expect(overwriteWarning(remoteNewer, 'remote')).toBeNull();
  });

  it('measures progress by tables, once there are tables to count', () => {
    expect(progressShare({ ...idleSync, state: 'running', tables_done: 5, tables_total: 20 })).toBe(0.25);
    expect(progressShare({ ...idleSync, state: 'running', step: 'Backing up Supabase' })).toBeNull();
    expect(progressShare({ ...idleSync, state: 'done', tables_done: 20, tables_total: 20 })).toBeNull();
  });

  it('describes each state', () => {
    const route = { source: 'local', dest: 'remote' } as const;
    const running = dbStatus({ sync: { ...idleSync, ...route, state: 'running', step: 'Copying nodes', tables_done: 11, tables_total: 26 } });
    expect(syncLine(running)).toBe('This computer → Supabase: Copying nodes (12 of 26 tables)');
    const checking = dbStatus({ sync: { ...idleSync, ...route, state: 'running', step: 'Backing up Supabase' } });
    expect(syncLine(checking)).toBe('This computer → Supabase: Backing up Supabase…');
    expect(syncLine(dbStatus({ sync: { ...idleSync, ...route, state: 'done', rows: 4213 } }))).toBe(
      'Synced This computer → Supabase: 4,213 rows copied.',
    );
    expect(syncLine(dbStatus({ sync: { ...idleSync, ...route, state: 'failed', error: 'timeout' } }))).toBe(
      'The sync This computer → Supabase failed: timeout. Supabase was left as it was.',
    );
    expect(syncLine(dbStatus())).toBe('');
  });

  it('calls the directions upload and download', () => {
    expect(syncVerb('local', labelOf)).toBe('Upload to Supabase');
    expect(syncVerb('remote', labelOf)).toBe('Download to this computer');
  });
});

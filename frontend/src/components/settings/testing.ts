/** Fixtures for the settings tests: `GET /settings` and `GET /database` answers. */
import type { BuildDefaults } from '../../lib/api/types/builds';
import type { DatabaseCounts, DatabaseStatus, DatabaseTargetPublic, SyncProgress } from '../../lib/api/types/database';
import type { SettingsPublic } from '../../lib/api/types/settings';

export const buildDefaults = (over: Partial<BuildDefaults> = {}): BuildDefaults => ({
  owner: null,
  visibility: 'private',
  claude_attribution: false,
  link_paper: true,
  max_minutes: 90,
  max_commits: 30,
  max_budget_usd: null,
  advanced: { model: 'auto', effort: 'auto', plan_model: 'auto', commit_style: 'milestone', tests: 'each_milestone', license: 'none', delivery: 'push_main', push: 'each_commit' },
  ...over,
});

/** A full `GET /settings` answer; nothing auto-derived, everything reviewed. */
export const settingsOf = (over: Partial<SettingsPublic> = {}): SettingsPublic => ({
  auto_derive: { book: [], paper: [] },
  auto_approve: 'off',
  builds: buildDefaults(),
  pills: { auto_generate: true, max_chapters_per_day: 4 },
  ...over,
});

/* A `GET /database` answer: two healthy databases, the main one in use. */

export const counts = (over: Partial<DatabaseCounts> = {}): DatabaseCounts => ({
  documents: 2,
  notes: 10,
  artifacts: 4,
  collections: 1,
  running_jobs: 0,
  last_change: '2026-10-01T10:00:00Z',
  ...over,
});

export const idleSync: SyncProgress = {
  state: 'idle',
  source: null,
  dest: null,
  step: '',
  table: null,
  tables_done: 0,
  tables_total: 0,
  rows: 0,
  backup_path: null,
  error: null,
  started_at: null,
  finished_at: null,
};

export function dbStatus(
  over: Partial<DatabaseStatus> = {},
  local: Partial<DatabaseTargetPublic> = {},
  remote: Partial<DatabaseTargetPublic> = {},
): DatabaseStatus {
  const active = over.active ?? 'remote';
  return {
    available: true,
    active,
    schema_problems: [],
    can_back_up: true,
    sync: idleSync,
    ...over,
    targets: [
      { target: 'local', label: 'This computer', host: '127.0.0.1:54329/bookshelf', active: active === 'local', reachable: true, error: null, pending_migrations: 0, counts: counts(), ...local },
      { target: 'remote', label: 'Supabase', host: 'pooler.supabase.com:5432/postgres', active: active === 'remote', reachable: true, error: null, pending_migrations: 0, counts: counts(), ...remote },
    ],
  };
}

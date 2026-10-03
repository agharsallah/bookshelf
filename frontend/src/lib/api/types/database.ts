/** Settings → Database wire shapes (backend/app/schemas/database.py, `GET /database`). */

export type DatabaseTarget = 'local' | 'remote';

export interface DatabaseCounts {
  documents: number;
  notes: number;
  artifacts: number;
  collections: number;
  running_jobs: number;
  last_change: string | null;
}

export interface DatabaseTargetPublic {
  target: DatabaseTarget;
  label: string;
  /** host:port/name, never the user or password. */
  host: string;
  active: boolean;
  reachable: boolean;
  error: string | null;
  /** Migrations this computer's cluster still has to apply (done before a switch or sync). */
  pending_migrations: number;
  counts: DatabaseCounts | null;
}

export type SyncState = 'idle' | 'running' | 'done' | 'failed';

export interface SyncProgress {
  state: SyncState;
  source: DatabaseTarget | null;
  dest: DatabaseTarget | null;
  step: string;
  table: string | null;
  tables_done: number;
  tables_total: number;
  rows: number;
  backup_path: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface DatabaseStatus {
  /** False when only one database is configured: nothing to switch or sync. */
  available: boolean;
  active: DatabaseTarget;
  targets: DatabaseTargetPublic[];
  schema_problems: string[];
  /** pg_dump is installed, so a sync can back up the database it replaces. */
  can_back_up: boolean;
  sync: SyncProgress;
}

/** Settings → Database → Snapshot wire shapes (backend/app/schemas/snapshots.py, `GET /database/snapshot`). */

export type SnapshotState = 'idle' | 'running' | 'done' | 'failed';
export type SnapshotAction = 'export' | 'restore';

export interface SnapshotProgress {
  state: SnapshotState;
  action: SnapshotAction | null;
  step: string;
  /** Tables and files handled so far, of `total`. */
  done: number;
  total: number;
  /** Rows a restore loaded. */
  rows: number;
  /** A restore's database backup (pg_dump), when one was asked for. */
  backup_path: string | null;
  /** Where a restore put the folders it replaced. */
  kept_path: string | null;
  /** The `embed` rebuild a restore queued. */
  reindex_job: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface SnapshotFile {
  name: string;
  size_bytes: number;
  created_at: string;
  documents: number;
  files: number;
}

export interface SnapshotStatus {
  /** The database a snapshot reads and a restore replaces. */
  database: string;
  can_back_up: boolean;
  /** The largest snapshot a restore accepts. */
  max_bytes: number;
  latest: SnapshotFile | null;
  progress: SnapshotProgress;
}

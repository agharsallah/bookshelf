/**
 * How the queue is steered (`QueueStatus.kinds`, `first_documents`), for the steering panel:
 * which kinds to list (those with queued work, and any already steered), what each may be
 * set to, how they group by stage, and each active choice as a chip that undoes it. Pure.
 */
import { JOB_KINDS, type JobKind, type KindMode, type QueueControlsUpdate, type QueueStatus } from '../../lib/api/types/jobs';
import { KIND_LABELS, STAGES } from './model';

export interface SteeringRow {
  kind: JobKind;
  label: string;
  queued: number;
  mode: KindMode | null;
  /** Skipping is offered only where the stage moves on without the kind. */
  skippable: boolean;
}

export const MODE_WORDS: Record<KindMode, string> = { first: 'first', hold: 'on hold', skip: 'skipped' };

/** Kinds with queued work or already steered; with `all`, every kind (Settings lists them all). */
export function steeringRows(queue: QueueStatus, { all = false }: { all?: boolean } = {}): SteeringRow[] {
  const modes = queue.kinds ?? {};
  const queued = queue.queued_kinds ?? {};
  const skippable = new Set(queue.skippable_kinds ?? []);
  return JOB_KINDS.filter((kind) => all || (queued[kind] ?? 0) > 0 || modes[kind]).map((kind) => ({
    kind,
    label: KIND_LABELS[kind],
    queued: queued[kind] ?? 0,
    mode: modes[kind] ?? null,
    skippable: skippable.has(kind),
  }));
}

export interface SteeringGroup {
  label: string;
  rows: SteeringRow[];
}

/** Rows under their book stage (Parse, Enrich, Distil…), the rest under "Papers and other". */
export function steeringGroups(rows: readonly SteeringRow[]): SteeringGroup[] {
  const groups = STAGES.map((stage) => ({ label: stage.label, rows: rows.filter((r) => stage.kinds.includes(r.kind)) }));
  const staged = new Set(STAGES.flatMap((stage) => stage.kinds));
  groups.push({ label: 'Papers and other', rows: rows.filter((r) => !staged.has(r.kind)) });
  return groups.filter((g) => g.rows.length > 0);
}

export interface SteeringChip {
  key: string;
  text: string;
  tone: KindMode;
  /** The update that undoes this one choice. */
  clear: QueueControlsUpdate;
}

/** Each active choice as a chip that can be undone on its own: kinds, then books. */
export function steeringChips(queue: QueueStatus, titleOf: (id: string) => string): SteeringChip[] {
  const kinds = (Object.entries(queue.kinds ?? {}) as [JobKind, KindMode][]).map(([kind, mode]) => ({
    key: `kind:${kind}`,
    text: `${KIND_LABELS[kind]} ${MODE_WORDS[mode]}`,
    tone: mode,
    clear: { kinds: { [kind]: null } },
  }));
  const first = queue.first_documents ?? [];
  const books = first.map((id) => ({
    key: `book:${id}`,
    text: `${titleOf(id)} first`,
    tone: 'first' as const,
    clear: { first_documents: first.filter((d) => d !== id) },
  }));
  return [...kinds, ...books];
}

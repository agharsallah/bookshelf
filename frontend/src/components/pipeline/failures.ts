/**
 * Failures grouped by what went wrong. Many failed jobs share one cause ("ch24 is inside
 * a skipped container", "ch25 is inside…"), so the pipeline lists each cause once: its
 * error signature (the first line with anchors, numbers, ids, quoted values and inline
 * data replaced by placeholders), the jobs it hit, newest first, and one retry for all.
 * Pure; ./FailureGroups.tsx draws it.
 */
import { anchorLabel } from '../../lib/anchors';
import type { JobKind, JobPublic } from '../../lib/api/types/jobs';

const QUOTED = /(?<!\w)"(?:[^"\\]|\\.)*"(?!\w)|(?<!\w)'(?:[^'\\]|\\.)*'(?!\w)/g;
// Placeholders without brackets, so nested data collapses from the inside out.
const OBJ = '\uE001';
const LIST = '\uE002';
const TEXT = '\uE003';
const INNERMOST = /\{[^{}[\]]*\}|\[[^{}[\]]*\]/g;
const UNCLOSED = /[{[][^{}[\]]*$/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID = /\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi;
const ANCHOR = /\b[a-z]{1,3}\d+(?:\/[a-z]{1,3}\d+)*\b/g;
const NUMBER = /\d+(?:\.\d+)?/g;

// Clauses the backend joins with "; " ("schema: blocks/2: …; schema: blocks/6: …").
const CLAUSE_BREAK = /;\s+(?=[\w ]+: )/;
// The backend cuts each clause's message at 300 characters (app/pipeline/gates.py).
const CUT_AT = 300;
const LINE_CUT_AT = 4000;
const DATA = /[\uE001\uE002]/;

const collapse = (text: string, pattern: RegExp) => {
  for (let before = ''; before !== text; ) {
    before = text;
    text = text.replace(pattern, (m) => (m.startsWith('{') ? OBJ : LIST));
  }
  return text;
};

function clauseSignature(raw: string): string {
  // Inline data first, then anything an error cut off mid-data (brackets left open).
  let text = collapse(collapse(raw.replace(QUOTED, TEXT), INNERMOST), UNCLOSED);
  // A cut clause says something partial after its data ("{…} is no"): stop at the data.
  const data = DATA.exec(text);
  if (raw.length >= CUT_AT && data) text = text.slice(0, data.index + 1);
  return text
    .replace(UUID, '‹id›')
    .replace(HEX_ID, '‹id›')
    .replace(ANCHOR, '‹anchor›')
    .replace(NUMBER, 'N')
    .replaceAll(OBJ, '{…}')
    .replaceAll(LIST, '[…]')
    .replaceAll(TEXT, '‘…’')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * What an error says once the specifics are gone: the same cause yields the same
 * signature whichever chapter, block or value it hit. Repeated clauses are said once.
 */
export function errorSignature(error: string | null): string {
  const line = (error ?? '').split('\n')[0]?.trim() ?? '';
  if (!line) return 'Failed without an error message';
  const raw = line.split(CLAUSE_BREAK);
  // The whole error is cut at 4000 characters (app/jobs/queue.py): drop a cut last clause.
  if ((error ?? '').length >= LINE_CUT_AT && raw.length > 1) raw.pop();
  const [first = '', ...rest] = raw.map(clauseSignature);
  // The first clause may lead in ("output rejected after one retry: schema: …"): compare
  // clauses without it, so a repeat of the first one is caught too.
  const label = rest[0]?.slice(0, rest[0].indexOf(': ') + 2) ?? '';
  const at = label ? first.indexOf(label) : -1;
  const lead = at > 0 ? first.slice(0, at) : '';
  const clauses: string[] = [];
  for (const clause of [first.slice(lead.length), ...rest]) {
    // Said once: the same clause, or a cut copy of one (a prefix of it), longest kept.
    const longer = clauses.findIndex((kept) => clause.startsWith(kept));
    if (!clause || clauses.some((kept) => kept.startsWith(clause))) continue;
    if (longer >= 0) clauses[longer] = clause;
    else clauses.push(clause);
  }
  return lead + clauses.join('; ');
}

export interface FailureGroup {
  signature: string;
  /** The group's jobs, newest failure first. */
  jobs: JobPublic[];
  kinds: JobKind[];
  documentIds: string[];
  anchors: string[];
  /** When the newest of them failed (ISO), for ordering and "7 h ago". */
  latest: string;
}

const failedAt = (job: JobPublic) => job.finished_at ?? job.created_at;

/** Failed jobs grouped by error signature; groups and their jobs newest first. */
export function groupFailures(jobs: readonly JobPublic[]): FailureGroup[] {
  const groups = new Map<string, JobPublic[]>();
  for (const job of jobs) {
    const key = errorSignature(job.error);
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return [...groups.entries()]
    .map(([signature, members]) => {
      const sorted = [...members].sort((a, b) => failedAt(b).localeCompare(failedAt(a)));
      const unique = <T>(values: (T | null)[]) => [...new Set(values.filter((v): v is T => v !== null))];
      return {
        signature,
        jobs: sorted,
        kinds: unique(sorted.map((j) => j.kind)),
        documentIds: unique(sorted.map((j) => j.document_id)),
        anchors: unique(sorted.map((j) => j.anchor)),
        latest: failedAt(sorted[0] as JobPublic),
      };
    })
    .sort((a, b) => b.latest.localeCompare(a.latest));
}

/**
 * Anchors in a few characters: chapter numbers as runs ("24–28"), the rest as their
 * labels in book order ("14.1"), at most `max` items then "+N more".
 */
export function compactAnchors(anchors: readonly string[], max = 8): string {
  const labels = [...new Set(anchors.map(anchorLabel))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const items: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length) items.push(run.length > 1 ? `${run[0]}–${run.at(-1)}` : String(run[0]));
    run = [];
  };
  for (const label of labels) {
    if (/^\d+$/.test(label)) {
      const n = Number(label);
      if (run.length && n !== (run.at(-1) as number) + 1) flush();
      run.push(n);
    } else {
      flush();
      items.push(label);
    }
  }
  flush();
  const rest = items.length - max;
  return rest > 0 ? `${items.slice(0, max).join(', ')} +${rest} more` : items.join(', ');
}

export interface Settled<T, R> {
  done: { item: T; value: R }[];
  failed: { item: T; error: unknown }[];
}

/**
 * Run `task` over `items`, at most `concurrency` at a time, reporting each one that
 * settles; never rejects, so one refused retry does not stop the rest.
 */
export async function runAll<T, R>(
  items: readonly T[],
  task: (item: T) => Promise<R>,
  { concurrency = 3, onSettled }: { concurrency?: number; onSettled?: (settled: number, total: number) => void } = {},
): Promise<Settled<T, R>> {
  const result: Settled<T, R> = { done: [], failed: [] };
  let next = 0;
  let settled = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      try {
        result.done.push({ item, value: await task(item) });
      } catch (error) {
        result.failed.push({ item, error });
      }
      onSettled?.(++settled, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return result;
}

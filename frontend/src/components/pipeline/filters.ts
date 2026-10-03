/**
 * What the pipeline page shows: filters by state, kind, document and free text, kept in
 * the URL (`?state=failed&q=attention`) so a filtered view survives a reload and can be
 * shared, and which documents count as active. Pure.
 */
import { JOB_KINDS, JOB_STATES, type JobKind, type JobPublic, type JobState } from '../../lib/api/types/jobs';
import { anchorLabel } from '../../lib/anchors';
import { KIND_LABELS } from './model';

export interface JobFilters {
  state?: JobState | '';
  kind?: JobKind | '';
  document?: string;
  /** Free text over the document title, kind, section and skill; case-insensitive. */
  q?: string;
}

const KEYS = ['state', 'kind', 'document', 'q'] as const;

export const hasFilters = (filters: JobFilters): boolean => KEYS.some((key) => Boolean(filters[key]?.trim()));

/** The filters a URL asks for; unknown states and kinds are dropped. */
export function filtersFromSearch(search: URLSearchParams): JobFilters {
  const state = search.get('state') ?? '';
  const kind = search.get('kind') ?? '';
  return {
    state: (JOB_STATES as readonly string[]).includes(state) ? (state as JobState) : '',
    kind: (JOB_KINDS as readonly string[]).includes(kind) ? (kind as JobKind) : '',
    document: search.get('document') ?? '',
    q: search.get('q') ?? '',
  };
}

/** `search` with the filters set and the empty ones removed; other parameters are kept. */
export function filtersToSearch(filters: JobFilters, search = new URLSearchParams()): URLSearchParams {
  const next = new URLSearchParams(search);
  for (const key of KEYS) {
    const value = filters[key]?.trim();
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
}

/** Whether a job matches every word of `q` in its title, kind, section or skill. */
export function matchesText(job: JobPublic, title: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [title, KIND_LABELS[job.kind], job.kind, job.anchor ? anchorLabel(job.anchor) : '', job.anchor ?? '', job.skill ?? '']
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterJobs(jobs: readonly JobPublic[], filters: JobFilters, titleOf: (job: JobPublic) => string = () => ''): JobPublic[] {
  const q = filters.q?.trim() ?? '';
  return jobs.filter(
    (j) =>
      (!filters.state || j.state === filters.state) &&
      (!filters.kind || j.kind === filters.kind) &&
      (!filters.document || j.document_id === filters.document) &&
      (!q || matchesText(j, titleOf(j), q)),
  );
}

/** Documents with work queued, running or failed among `jobs`: the ones worth watching. */
export function activeDocumentIds(jobs: readonly JobPublic[]): Set<string> {
  const ids = new Set<string>();
  for (const job of jobs) if (job.document_id && job.state !== 'done' && job.state !== 'skipped') ids.add(job.document_id);
  return ids;
}

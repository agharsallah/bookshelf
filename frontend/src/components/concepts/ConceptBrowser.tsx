/**
 * The concept index: find a concept by name or alias (typeahead over `GET /concepts`),
 * narrow by kind, order A to Z, by most connected (a good place to start a walk) or
 * newest, and open its page or its neighbourhood. Recently visited concepts (kept in
 * this browser) come first when nothing is typed.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { Page } from '../../lib/api/types';
import { CONCEPT_KINDS, CONCEPT_SORTS, type ConceptKind, type ConceptSort, type ConceptSummary } from '../../lib/api/types/graph';
import { graphHref } from '../graph/refs';
import { conceptHref } from '../search/links';
import { loadRecent, RECENT_CONCEPTS_KEY, type RecentEntry } from '../search/recent';
import styles from './Browser.module.css';

const KIND_LABELS: Record<ConceptKind, string> = { concept: 'Concepts', framework: 'Frameworks', person: 'People', work: 'Works', term: 'Terms' };
const SORT_LABELS: Record<ConceptSort, string> = { alpha: 'A to Z', connected: 'Most connected', recent: 'Newest' };
const SORT_PHRASES: Record<ConceptSort, string> = { alpha: 'A to Z', connected: 'most connected first', recent: 'newest first' };
const links = (n: number) => `${n} link${n === 1 ? '' : 's'}`;

export interface ConceptBrowserProps {
  initial: Page<ConceptSummary> | null;
  api?: ApiClient;
  debounceMs?: number;
}

export function ConceptBrowser({ initial, api = browserApi, debounceMs = 180 }: ConceptBrowserProps) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<ConceptKind | null>(null);
  const [sort, setSort] = useState<ConceptSort>('alpha');
  const [page, setPage] = useState<Page<ConceptSummary> | null>(initial);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const first = useRef(true);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => setRecent(loadRecent(RECENT_CONCEPTS_KEY)), []);

  useEffect(() => {
    if (first.current && initial) {
      first.current = false;
      return;
    }
    first.current = false;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api
        .get<Page<ConceptSummary>>('concepts', { query: { q: q.trim() || undefined, kind: kind ?? undefined, sort, limit: 40 }, signal: controller.signal })
        .then((next) => {
          setPage(next);
          setProblem(null);
        })
        .catch((error: unknown) => !controller.signal.aborted && setProblem(problemOf(error)));
    }, debounceMs);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [api, q, kind, sort, initial, debounceMs]);

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'ArrowDown') return;
    const link = list.current?.querySelector<HTMLAnchorElement>('a');
    if (link) {
      event.preventDefault();
      link.focus();
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>('a[data-concept]') ?? [])];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    const next = links[at + (event.key === 'ArrowDown' ? 1 : -1)];
    event.preventDefault();
    if (next) next.focus();
    else if (event.key === 'ArrowUp') document.getElementById('concept-q')?.focus();
  };

  const items = page?.items ?? [];
  return (
    <div className={styles.browser}>
      <div className={styles.search}>
        <label htmlFor="concept-q" className="visually-hidden">
          Find a concept
        </label>
        <input
          id="concept-q"
          className={styles.input}
          type="search"
          value={q}
          placeholder="Find a concept, a person, a term…"
          autoComplete="off"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKey}
        />
        <div className={styles.kinds} role="group" aria-label="Kind">
          <button type="button" aria-pressed={kind === null} onClick={() => setKind(null)}>
            All
          </button>
          {CONCEPT_KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              {KIND_LABELS[k]}
            </button>
          ))}
        </div>
        <div className={styles.kinds} role="group" aria-label="Order">
          {CONCEPT_SORTS.map((key) => (
            <button key={key} type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {!q.trim() && recent.length > 0 ? (
        <section className={styles.recent} aria-label="Recently visited">
          <h3>Recently visited</h3>
          <ul>
            {recent.map((r) => (
              <li key={r.href}>
                <a href={r.href}>{r.label}</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {problem ? <Problem inline title="Concepts could not be loaded." problem={problem} /> : null}
      <p className={styles.count} aria-live="polite">
        {page ? (q.trim() ? `${page.total} ${page.total === 1 ? 'match' : 'matches'}` : `${page.total} concepts, ${SORT_PHRASES[sort]}`) : ''}
      </p>
      {items.length === 0 && page ? (
        <p className={styles.empty}>
          {q.trim() ? `No concept is called “${q.trim()}”, or has it as an alias.` : 'No concepts yet. They appear once books are linked.'}
        </p>
      ) : (
        <ul ref={list} className={styles.list} onKeyDown={onListKey}>
          {items.map((c) => (
            <li key={c.id} className={styles.item}>
              <a className={styles.name} href={conceptHref(c.id)} data-concept="">
                {c.canonical}
              </a>
              <span className={styles.kind}>{c.kind}</span>
              {c.edge_count !== undefined ? <span className={styles.links}>{links(c.edge_count)}</span> : null}
              {c.aliases.length ? <span className={styles.aliases}>{c.aliases.join(', ')}</span> : null}
              {c.blurb ? <p className={styles.blurb}>{c.blurb}</p> : null}
              <a className={styles.graph} href={graphHref(`concept:${c.id}`)} aria-label={`${c.canonical} in the graph`}>
                Graph
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default ConceptBrowser;

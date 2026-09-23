/**
 * Search (§10, §12): the query line with its live intent, filters, grouped results and
 * the streamed, cited answer. State lives in the URL (`?q=&mode=&doc=&tag=&type=`) so
 * every search can be shared or bookmarked; `&ask=1` asks straight away (the palette's
 * "Ask" uses it) and is then dropped from the address.
 *
 * Keys: `/` focuses the query · ↓/↑ move through hits · Enter opens · Esc returns to
 * the query.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Problem } from '../document/Problem';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { SearchMode } from '../../lib/api/types/search';
import { useAnswerStream } from '../../lib/hooks/useAnswerStream';
import { useSearchResults } from '../../lib/hooks/useSearchResults';
import { AnswerPanel } from './AnswerPanel';
import { Filters, type FilterDocument } from './Filters';
import { QueryBar } from './QueryBar';
import { loadRecent, RECENT_SEARCHES_KEY, saveRecent, type RecentEntry } from './recent';
import { Results } from './ResultList';
import { RelationsNote } from './RelationsNote';
import { buildResults, stepHit, type HitView } from './results';
import { useSearchKeys } from './useSearchKeys';
import { searchHref, toSearchParams, toSearchRequest, type SearchState } from './url-state';
import styles from './Search.module.css';

export interface SearchPageProps {
  initial: SearchState;
  askOnLoad?: boolean;
  documents: FilterDocument[];
  tags: string[];
  api?: ApiClient;
  fetch?: typeof fetch;
  /** Typing waits this long before searching. */
  debounceMs?: number;
}

export function SearchPage({ initial, askOnLoad = false, documents, tags, api = browserApi, fetch: fetchImpl, debounceMs = 300 }: SearchPageProps) {
  const [state, setState] = useState<SearchState>(initial);
  // What is actually searched: updated on every keystroke but debounced by the hook.
  const request = useMemo(() => toSearchRequest(state), [state]);
  const [typing, setTyping] = useState(false);
  const results = useSearchResults(api, request, typing ? debounceMs : 0);
  const answer = useAnswerStream(fetchImpl);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);

  useEffect(() => setRecent(loadRecent(RECENT_SEARCHES_KEY)), []);

  // Keep the address in step with what is shown (replace: typing is not history).
  useEffect(() => {
    const qs = toSearchParams(state);
    const next = qs ? `/search?${qs}` : '/search';
    if (`${location.pathname}${location.search}` !== next) history.replaceState(history.state, '', next);
  }, [state]);

  const view = useMemo(() => (results.response ? buildResults(results.response) : null), [results.response]);

  const remember = useCallback(() => {
    const q = state.q.trim();
    if (q) setRecent(saveRecent(RECENT_SEARCHES_KEY, { label: q, href: searchHref(state) }));
  }, [state]);

  const ask = useCallback(() => {
    const body = toSearchRequest(state);
    if (!body) return;
    remember();
    answer.ask(body);
  }, [state, answer, remember]);

  const askedOnLoad = useRef(false);
  useEffect(() => {
    if (!askOnLoad || askedOnLoad.current) return;
    askedOnLoad.current = true;
    ask();
  }, [askOnLoad, ask]);

  const focusHit = useCallback((index: number) => {
    setActive(index);
    if (index < 0) return input.current?.focus();
    list.current?.querySelectorAll<HTMLElement>('[data-hit]')[index]?.focus();
  }, []);

  const hitCount = () => list.current?.querySelectorAll('[data-hit]').length ?? 0;

  const onInputKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && hitCount() > 0) {
      event.preventDefault();
      focusHit(0);
    }
  };

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const count = hitCount();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusHit(stepHit(active, event.key === 'ArrowDown' ? 1 : -1, count));
    } else if (event.key === 'Escape') {
      focusHit(-1);
    }
  };

  useSearchKeys(input);

  const onOpen = (_hit: HitView, _event: MouseEvent<HTMLAnchorElement>) => remember();
  const patch = (next: Partial<SearchState>, isTyping = false) => {
    setTyping(isTyping);
    setActive(-1);
    setState((s) => ({ ...s, ...next }));
  };

  const empty = !state.q.trim();
  const intent = results.response && results.answered?.query === request?.query ? results.response.intent : null;

  return (
    <div className={styles.search}>
      <QueryBar
        ref={input}
        query={state.q}
        mode={state.mode}
        intent={empty ? null : intent}
        loading={results.loading}
        asking={answer.state.phase === 'streaming'}
        onQuery={(q) => patch({ q }, true)}
        onMode={(mode: SearchMode) => patch({ mode })}
        onSubmit={() => {
          patch({ q: state.q.trim() });
          remember();
        }}
        onAsk={ask}
        onKeyDown={onInputKey}
      />
      <Filters state={state} documents={documents} tags={tags} onChange={(p) => patch(p)} />

      {answer.state.phase !== 'idle' ? (
        <AnswerPanel state={answer.state} onCancel={answer.cancel} onRetry={ask} onClose={answer.reset} />
      ) : null}

      {/* The hit list is a keyboard region: arrows move between hits, Esc returns to the query. */}
      <div ref={list} className={styles.results} onKeyDown={onListKey} onFocus={(e) => syncActive(e.target, list.current, setActive)}>
        {empty ? (
          <Recent recent={recent} />
        ) : results.problem ? (
          <Problem title="The search could not run." problem={results.problem} />
        ) : view && view.total === 0 && !view.resolved ? (
          <p className={styles.empty}>
            Nothing on the shelf matches “{state.q.trim()}”. Try other words, switch to Lexical for an exact phrase, or clear the filters.
          </p>
        ) : view ? (
          <>
            <p className={styles.summary} aria-live="polite">
              {summaryLine(view.total, view.groups.length, results.response?.took_ms ?? 0)}
            </p>
            <RelationsNote relations={results.response?.relations ?? []} groups={results.response?.groups ?? []} />
            <Results view={view} intent={results.response?.intent ?? 'discovery'} onOpen={onOpen} />
          </>
        ) : (
          <p className={styles.summary}>Searching…</p>
        )}
      </div>
    </div>
  );
}

function syncActive(target: EventTarget, root: HTMLElement | null, set: (i: number) => void) {
  if (!root || !(target instanceof HTMLElement) || !target.hasAttribute('data-hit')) return;
  set([...root.querySelectorAll('[data-hit]')].indexOf(target));
}

function summaryLine(hits: number, books: number, ms: number): string {
  const h = hits === 1 ? '1 match' : `${hits} matches`;
  const b = books === 1 ? '1 book' : `${books} books`;
  return `${h} in ${b}, ${ms} ms`;
}

function Recent({ recent }: { recent: RecentEntry[] }) {
  if (recent.length === 0) {
    return (
      <p className={styles.empty}>
        Ask about an idea (“what do I know about feedback loops?”), name a chapter (“chapter 3 of Meadows”), or quote a phrase in
        double quotes to find the exact words.
      </p>
    );
  }
  return (
    <section className={styles.recent} aria-label="Recent searches">
      <h2>Recent</h2>
      <ul>
        {recent.map((r) => (
          <li key={r.href}>
            <a href={r.href}>{r.label}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SearchPage;

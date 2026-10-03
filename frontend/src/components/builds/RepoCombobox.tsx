/**
 * Pick one of your GitHub repositories (`GET /builds/repos?q=`): an ARIA combobox that
 * searches as you type (debounced), each option with its visibility and when it last
 * changed. A repository you cannot push to shows *read-only* and cannot be picked.
 * Arrow keys move, Enter picks, Escape closes.
 */
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { RepoChoice } from '../../lib/api/types/builds';
import { listRepos } from '../../lib/builds/api';
import { problemOf } from '../common/Problem';
import fields from './Fields.module.css';
import styles from './Target.module.css';

export const SEARCH_DELAY_MS = 250;

export interface RepoComboboxProps {
  api: Pick<ApiClient, 'get'>;
  /** The repository picked (`owner/name`), or blank. */
  value: string;
  onPick: (repo: RepoChoice) => void;
  error?: string | undefined;
  delayMs?: number;
}

const ago = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `updated ${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}`;
};

export function RepoCombobox({ api, value, onPick, error, delayMs = SEARCH_DELAY_MS }: RepoComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [repos, setRepos] = useState<RepoChoice[] | null>(null);
  const [status, setStatus] = useState('');
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => {
      setStatus('Searching…');
      listRepos(api, query.trim()).then(
        (found) => {
          if (!live) return;
          setRepos(found);
          setActive(found.findIndex((r) => r.can_push));
          setStatus(found.length ? `${found.length} ${found.length === 1 ? 'repository' : 'repositories'}.` : 'No repository of yours matches.');
        },
        (failure: unknown) => {
          if (!live) return;
          setRepos(null);
          setStatus(`Not searched: ${problemOf(failure).message}`);
        },
      );
    }, delayMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, query, open, delayMs]);

  const pick = (repo: RepoChoice | undefined) => {
    if (!repo?.can_push) return;
    setQuery(repo.full_name);
    setOpen(false);
    onPick(repo);
  };

  /** The next pickable option in that direction, wrapping around (read-only ones are skipped). */
  const move = (by: 1 | -1) => {
    const list = repos ?? [];
    const n = list.length;
    const next = list.map((_, i) => (((active + by * (i + 1)) % n) + n) % n).find((i) => list[i]?.can_push);
    if (next !== undefined) setActive(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      else move(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      // Never submits the build form around it.
      event.preventDefault();
      if (open) pick(repos?.[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  const shown = open && repos && repos.length > 0;
  return (
    <div className={fields.field}>
      <label className={fields.label} htmlFor={id}>
        Repository
      </label>
      <div className={styles.combo}>
        <input
          id={id}
          className={`${fields.input} ${fields.mono}`}
          role="combobox"
          aria-expanded={Boolean(shown)}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-status`}
          autoComplete="off"
          placeholder="Search your repositories…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <ul id={listId} role="listbox" aria-label="Your repositories" className={styles.options} hidden={!shown}>
          {(repos ?? []).map((r, i) => (
            <li
              key={r.full_name}
              id={`${id}-opt-${i}`}
              role="option"
              className={styles.option}
              aria-selected={i === active}
              aria-disabled={!r.can_push || undefined}
              // Picking on mousedown keeps the input from blurring (and closing the list) first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(r);
              }}
            >
              <span className={styles.optionName}>{r.full_name}</span>
              <span className={styles.optionMeta}>
                <span className={styles.pill}>{r.visibility.toLowerCase()}</span>
                {!r.can_push ? <span className={styles.pill} data-tone="caution">read-only</span> : null}
                <span>{ago(r.updated_at)}</span>
              </span>
              {r.description ? <span className={styles.optionHint}>{r.description}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <p id={`${id}-status`} className={fields.hint} role="status">
        {open ? status : value ? `Building into ${value}.` : 'Repositories you or your organizations have; one you cannot push to is read-only.'}
      </p>
      {error ? <p className={fields.error}>{error}</p> : null}
    </div>
  );
}

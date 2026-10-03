/**
 * The references a build reads beside the paper (docs/BUILDS.md §7): one-click chips for
 * what the paper itself points at (its code, its data, its arXiv page, works it cites,
 * papers of your shelf it cites), the list of what you added (a note each, a snapshot
 * switch for links), and the two ways to add your own.
 */
import { useState } from 'react';
import type { ApiClient } from '../../lib/api/client';
import type { BuildReference, SuggestedReference } from '../../lib/api/types/builds';
import { CONTEXT_LIMITS, fromSuggestion, groupSuggestions, hostOf, isAdded } from '../../lib/builds/context';
import { removeAt, replaceAt } from '../../lib/builds/plan';
import { Switch } from './Disclosure';
import fields from './Fields.module.css';
import styles from './Context.module.css';
import { AddFromShelf, AddLink } from './ReferenceAdders';

export interface ReferencesEditorProps {
  api: Pick<ApiClient, 'get'>;
  paperRef: string;
  suggestions: readonly SuggestedReference[];
  references: BuildReference[];
  onChange: (next: BuildReference[]) => void;
  allowWeb: boolean;
  error?: string | undefined;
}

export function ReferencesEditor({ api, paperRef, suggestions, references, onChange, allowWeb, error }: ReferencesEditorProps) {
  const [adding, setAdding] = useState<'link' | 'shelf' | null>(null);
  const full = references.length >= CONTEXT_LIMITS.references;
  const add = (ref: BuildReference) => {
    if (!full && !isAdded(references, ref)) onChange([...references, ref]);
  };
  const update = (i: number, patch: Partial<BuildReference>) => {
    const ref = references[i];
    if (ref) onChange(replaceAt(references, i, { ...ref, ...patch }));
  };
  const linkOnly = !allowWeb && references.some((r) => r.kind === 'url' && !r.snapshot);
  const groups = groupSuggestions(suggestions);

  return (
    <section className={styles.block} aria-labelledby="refs-title">
      <div className={styles.blockHead}>
        <h4 id="refs-title" className={styles.blockTitle}>
          References
        </h4>
        <span className={styles.count} aria-live="polite">
          {references.length} of {CONTEXT_LIMITS.references}
        </span>
      </div>
      <p className={fields.hint}>Code, pages and papers the agent reads beside the paper. They go in docs/REFERENCES.md.</p>

      {groups.length > 0 ? (
        <div className={styles.suggestions}>
          {groups.map((g) => (
            <div key={g.source} className={styles.suggestionGroup}>
              <span className={styles.groupLabel}>{g.label}</span>
              <ul className={fields.chips}>
                {g.items.map((s) => {
                  const on = isAdded(references, s);
                  return (
                    <li key={`${s.kind}:${s.url ?? s.document_id ?? s.title}`}>
                      <button
                        type="button"
                        className={`${fields.chip} ${styles.suggestion}`}
                        disabled={on || full}
                        title={s.url ?? undefined}
                        aria-label={on ? `${s.title} (added)` : `Add ${s.title}`}
                        onClick={() => add(fromSuggestion(s))}
                      >
                        <span aria-hidden="true">{on ? '✓' : '+'}</span> {s.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}

      {references.length > 0 ? (
        <ol className={styles.refs}>
          {references.map((r, i) => (
            <li key={`${r.kind}:${r.url ?? r.document_id}`} className={styles.ref}>
              <div className={styles.refHead}>
                <span className={styles.refKind} data-kind={r.kind}>
                  {r.kind === 'shelf' ? 'shelf' : hostOf(r.url ?? '')}
                </span>
                <span className={styles.refTitle}>{r.title}</span>
                <button type="button" className={`btn btn-quiet ${fields.iconBtn}`} aria-label={`Remove ${r.title}`} onClick={() => onChange(removeAt(references, i))}>
                  ✕
                </button>
              </div>
              <input
                className={`${fields.input} ${styles.refNote}`}
                aria-label={`Note for ${r.title}`}
                placeholder="A note: why it matters, how to use it"
                maxLength={CONTEXT_LIMITS.refNote}
                value={r.note ?? ''}
                onChange={(e) => update(i, { note: e.target.value })}
              />
              {r.kind === 'url' ? <Switch label={`Snapshot ${r.title}`} checked={r.snapshot} onChange={(snapshot) => update(i, { snapshot })} /> : null}
            </li>
          ))}
        </ol>
      ) : null}

      {linkOnly ? (
        <p className={styles.note} role="note">
          The agent cannot browse (web access is off), so a link that is not snapshotted is only a name to it. Snapshot it to give it the text.
        </p>
      ) : null}
      {error ? <p className={fields.error}>{error}</p> : null}

      <div className={fields.actions}>
        <button type="button" className="btn btn-quiet" aria-expanded={adding === 'link'} disabled={full} onClick={() => setAdding(adding === 'link' ? null : 'link')}>
          + Add a link
        </button>
        <button type="button" className="btn btn-quiet" aria-expanded={adding === 'shelf'} disabled={full} onClick={() => setAdding(adding === 'shelf' ? null : 'shelf')}>
          + Add from shelf
        </button>
      </div>
      {adding === 'link' ? (
        <AddLink
          onAdd={(ref) => {
            add(ref);
            setAdding(null);
          }}
          onCancel={() => setAdding(null)}
        />
      ) : null}
      {adding === 'shelf' ? <AddFromShelf api={api} paperRef={paperRef} added={references} full={full} onAdd={add} /> : null}
    </section>
  );
}

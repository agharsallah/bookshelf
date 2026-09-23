/**
 * The structured block editor (D15): edit span text and cites, reorder / delete / add
 * blocks from the closed set, change callout tones. Raw JSON is an advanced toggle with
 * validation. Saving hands the full body to `onSave`, which stores a new human version.
 */
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import { ApiError } from '../../../lib/api/errors';
import { problemOf, Problem, type ProblemInfo } from '../../document/Problem';
import type { SourceBlock } from '../api';
import { BlockSlip } from './BlockSlip';
import { INSERTABLE, type InsertableType } from './model';
import { editorBody, editorReducer, initEditor } from './reducer';
import { blockProblems, parseRawBody, validateLists } from './validate';
import styles from './Editor.module.css';

export interface BlockEditorProps {
  initialBody: Record<string, unknown>;
  sources: readonly SourceBlock[];
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
  saveLabel: string;
}

function InsertBar({ list, at, onInsert }: { list: number; at: number; onInsert: (list: number, at: number, type: InsertableType) => void }) {
  return (
    <label className={styles.insert}>
      <span className="visually-hidden">Insert a block at position {at + 1}</span>
      <select value="" onChange={(e) => e.target.value && onInsert(list, at, e.target.value as InsertableType)}>
        <option value="">Add a block here…</option>
        {INSERTABLE.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

function serverDetails(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  return error.details.map((d) => (typeof d.msg === 'string' ? d.msg : typeof d.message === 'string' ? d.message : JSON.stringify(d)));
}

export function BlockEditor({ initialBody, sources, onSave, onCancel, saveLabel }: BlockEditorProps) {
  const [state, dispatch] = useReducer(editorReducer, initialBody, initEditor);
  const structured = state.lists.length > 0;
  const [raw, setRaw] = useState(!structured);
  const [rawText, setRawText] = useState(() => JSON.stringify(initialBody, null, 2));
  const [rawError, setRawError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<{ problem: ProblemInfo; details: string[] } | null>(null);
  const [focusBlock, setFocusBlock] = useState<[number, number] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const rawId = useId();

  const problems = useMemo(() => validateLists(state.lists), [state.lists]);
  const list = state.lists[state.active];

  useEffect(() => {
    const first = root.current?.querySelector<HTMLElement>('textarea') ?? root.current?.querySelector<HTMLElement>('input:not([type=checkbox]), select');
    first?.focus();
  }, []);

  useEffect(() => {
    if (!focusBlock) return;
    const [l, b] = focusBlock;
    const slip = root.current?.querySelector(`[data-editor-block="${l}-${b}"]`);
    const target = slip?.querySelector<HTMLElement>('textarea, input, select:not([aria-label^="Tone"])') ?? slip?.querySelector<HTMLElement>('button');
    (target ?? root.current?.querySelector<HTMLElement>('[data-editor-list] select'))?.focus();
    setFocusBlock(null);
  }, [focusBlock]);

  const insert = (l: number, at: number, type: InsertableType) => {
    dispatch({ type: 'insertBlock', list: l, at, block: type });
    setFocusBlock([l, at]);
  };

  const toggleRaw = () => {
    if (!raw) {
      setRawText(JSON.stringify(editorBody(state), null, 2));
      setRawError(null);
      setRaw(true);
      return;
    }
    const parsed = parseRawBody(rawText);
    if ('error' in parsed) return setRawError(parsed.error);
    dispatch({ type: 'replaceBody', body: parsed.body });
    setRaw(false);
  };

  const save = async () => {
    let body = editorBody(state);
    if (raw) {
      const parsed = parseRawBody(rawText);
      if ('error' in parsed) return setRawError(parsed.error);
      const invalid = Array.isArray(parsed.body.blocks) ? parsed.body.blocks.flatMap(blockProblems) : [];
      if (invalid.length) return setRawError(invalid.join(' '));
      body = parsed.body;
    }
    setSaving(true);
    setFailure(null);
    try {
      await onSave(body);
    } catch (error) {
      setFailure({ problem: problemOf(error), details: serverDetails(error) });
    } finally {
      setSaving(false);
    }
  };

  const blocked = saving || (!raw && (problems.length > 0 || !state.dirty));

  return (
    <div className={styles.editor} ref={root} onKeyDown={(e) => e.key === 'Escape' && e.target === e.currentTarget && onCancel()}>
      <div className={styles.toolbar}>
        {structured && !raw && state.lists.length > 1 ? (
          <div className={styles.lists} role="group" aria-label="Brief sections">
            {state.lists.map((l, i) => (
              <button key={l.label} type="button" aria-pressed={i === state.active} onClick={() => dispatch({ type: 'setActive', list: i })}>
                {l.label}
              </button>
            ))}
          </div>
        ) : null}
        {structured ? (
          <label className={styles.toggle}>
            <input type="checkbox" checked={raw} onChange={toggleRaw} />
            Advanced: edit as JSON
          </label>
        ) : (
          <p className={styles.note}>This artifact’s shape has no block list; edit it as JSON.</p>
        )}
      </div>

      {raw ? (
        <div className={styles.raw}>
          <label htmlFor={rawId} className={styles.fieldLabel}>
            Body JSON
          </label>
          <textarea
            id={rawId}
            className={`${styles.input} ${styles.mono}`}
            rows={24}
            value={rawText}
            spellCheck={false}
            aria-invalid={rawError ? true : undefined}
            aria-describedby={rawError ? `${rawId}-error` : undefined}
            onChange={(e) => {
              setRawText(e.target.value);
              setRawError(null);
            }}
          />
          {rawError ? (
            <p id={`${rawId}-error`} className={styles.problemLine} role="alert">
              {rawError}
            </p>
          ) : null}
        </div>
      ) : list ? (
        <div className={styles.slips} data-editor-list={state.active}>
          <InsertBar list={state.active} at={0} onInsert={insert} />
          {list.blocks.map((block, index) => (
            <div key={`${state.active}-${index}`} className={styles.slipWrap}>
              <BlockSlip
                block={block}
                list={state.active}
                index={index}
                count={list.blocks.length}
                problems={problems.filter((p) => p.list === state.active && p.block === index).map((p) => p.message)}
                dispatch={(action) => {
                  dispatch(action);
                  if (action.type === 'removeBlock') setFocusBlock([action.list, Math.min(action.block, list.blocks.length - 2)]);
                  if (action.type === 'moveBlock') setFocusBlock([action.list, action.to]);
                }}
                sources={sources}
              />
              <InsertBar list={state.active} at={index + 1} onInsert={insert} />
            </div>
          ))}
        </div>
      ) : null}

      <footer className={styles.footer}>
        <p className={styles.status} aria-live="polite">
          {!raw && problems.length > 0
            ? `${problems.length} problem${problems.length === 1 ? '' : 's'} to fix before saving.`
            : state.dirty || raw
              ? 'Saving stores a new version written by you; the skill’s version stays for comparison.'
              : 'No changes yet.'}
        </p>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.primary} disabled={blocked} onClick={save}>
          {saving ? 'Saving…' : saveLabel}
        </button>
      </footer>
      {failure ? (
        <div className={styles.failure}>
          <Problem title="The server did not accept this version." problem={failure.problem} inline />
          {failure.details.length ? (
            <ul className={styles.problems}>
              {failure.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

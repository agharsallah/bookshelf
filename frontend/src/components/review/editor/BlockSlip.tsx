/**
 * One block in the editor: its type (and tone), move / delete controls, and the fields
 * that block type has. Charts and diagrams are data, edited in the advanced JSON view.
 */
import type { Dispatch } from 'react';
import { CALLOUT_TONES, type RenderBlock } from '../../../lib/contract';
import { TONES } from '../../blocks/callout-tones';
import type { SourceBlock } from '../api';
import { spanGroups } from './model';
import type { BlockField, EditorAction } from './reducer';
import { BlockCites, SpanFields } from './SpanFields';
import styles from './Editor.module.css';

export interface BlockSlipProps {
  block: RenderBlock;
  list: number;
  index: number;
  count: number;
  problems: readonly string[];
  dispatch: Dispatch<EditorAction>;
  sources: readonly SourceBlock[];
}

function Field({ label, value, onChange, multiline = false, mono = false }: { label: string; value: string; onChange: (v: string) => void; multiline?: boolean; mono?: boolean }) {
  const className = mono ? `${styles.input} ${styles.mono}` : styles.input;
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {multiline ? (
        <textarea className={className} value={value} rows={Math.min(14, Math.max(3, value.split('\n').length + 1))} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} />
      ) : (
        <input className={className} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={!mono} />
      )}
    </label>
  );
}

function Fields({ block, list, index, dispatch, sources }: Omit<BlockSlipProps, 'count' | 'problems'>) {
  const set = (field: BlockField) => (value: string | number | null) => dispatch({ type: 'setField', list, block: index, field, value });
  const groups = spanGroups(block);
  const at = (group: number) => ({ list, block: index, group });
  const cites = <T extends { cites: string[] }>(b: T) => <BlockCites cites={b.cites} list={list} block={index} dispatch={dispatch} sources={sources} />;

  switch (block.type) {
    case 'heading':
      return (
        <div className={styles.row}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Level</span>
            <select value={block.level} onChange={(e) => set('level')(Number(e.target.value))}>
              {[2, 3, 4].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <Field label="Heading" value={block.text} onChange={set('text')} />
        </div>
      );
    case 'paragraph':
    case 'callout':
    case 'definition':
      return (
        <>
          {block.type === 'callout' ? <Field label="Title (optional)" value={block.title ?? ''} onChange={set('title')} /> : null}
          {block.type === 'definition' ? <Field label="Term" value={block.term} onChange={set('term')} /> : null}
          <SpanFields spans={groups[0] ?? []} at={at(0)} label="Text" dispatch={dispatch} sources={sources} />
        </>
      );
    case 'bullets':
    case 'steps':
      return (
        <ol className={styles.itemList}>
          {groups.map((group, g) => (
            <li key={g}>
              <SpanFields spans={group} at={at(g)} label={`Item ${g + 1}`} dispatch={dispatch} sources={sources} />
              {groups.length > 1 ? (
                <button type="button" className={styles.quiet} onClick={() => dispatch({ type: 'removeItem', list, block: index, group: g })}>
                  Remove item {g + 1}
                </button>
              ) : null}
            </li>
          ))}
          <li>
            <button type="button" className={styles.quiet} onClick={() => dispatch({ type: 'addItem', list, block: index })}>
              Add an item
            </button>
          </li>
        </ol>
      );
    case 'table': {
      const width = block.header.length;
      return (
        <>
          <Field label="Caption (optional)" value={block.caption ?? ''} onChange={set('caption')} />
          <div className={styles.row}>
            {block.header.map((h, c) => (
              <Field key={c} label={`Column ${c + 1}`} value={h} onChange={(text) => dispatch({ type: 'setHeader', list, block: index, column: c, text })} />
            ))}
          </div>
          {groups.map((group, g) => (
            <SpanFields key={g} spans={group} at={at(g)} label={`Row ${Math.floor(g / width) + 1}, ${block.header[g % width] || `column ${(g % width) + 1}`}`} dispatch={dispatch} sources={sources} />
          ))}
          <button type="button" className={styles.quiet} onClick={() => dispatch({ type: 'addRow', list, block: index })}>
            Add a row
          </button>
        </>
      );
    }
    case 'quote':
      return (
        <>
          <Field label="Verbatim text" value={block.text} onChange={set('text')} multiline />
          <div className={styles.row}>
            <Field label="Attribution" value={block.attribution ?? ''} onChange={set('attribution')} />
            <Field label="Page" value={block.page === null ? '' : String(block.page)} onChange={(v) => set('page')(v === '' ? null : Number(v))} />
          </div>
          {cites(block)}
        </>
      );
    case 'code':
      return (
        <>
          <div className={styles.row}>
            <Field label="Language" value={block.language ?? ''} onChange={set('language')} />
            <Field label="Caption" value={block.caption ?? ''} onChange={set('caption')} />
          </div>
          <Field label="Listing (verbatim)" value={block.text} onChange={set('text')} multiline mono />
          {cites(block)}
        </>
      );
    case 'math':
      return (
        <>
          <Field label="LaTeX" value={block.latex} onChange={set('latex')} mono />
          {groups[0] ? <SpanFields spans={groups[0]} at={at(0)} label="Meaning" dispatch={dispatch} sources={sources} /> : null}
          {cites(block)}
        </>
      );
    case 'chart':
    case 'diagram':
      return (
        <>
          <p className={styles.note}>This {block.type}’s data is edited in the advanced JSON view.</p>
          {cites(block)}
        </>
      );
    default:
      return <p className={styles.note}>Unknown block; fix or remove it in the advanced JSON view.</p>;
  }
}

export function BlockSlip(props: BlockSlipProps) {
  const { block, list, index, count, problems, dispatch } = props;
  const name = block.type === 'callout' ? `${TONES[block.tone]?.label ?? 'Callout'} callout` : block.type;
  return (
    <section className={styles.slip} data-editor-block={`${list}-${index}`} data-invalid={problems.length > 0 || undefined} aria-label={`Block ${index + 1}: ${name}`}>
      <header className={styles.slipHead}>
        <span className={styles.slipType}>{name}</span>
        {block.type === 'callout' ? (
          <label className={styles.inline}>
            <span className="visually-hidden">Tone</span>
            <select value={block.tone} onChange={(e) => dispatch({ type: 'setField', list, block: index, field: 'tone', value: e.target.value })}>
              {CALLOUT_TONES.map((tone) => (
                <option key={tone} value={tone}>
                  {TONES[tone].label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className={styles.slipTools}>
          <button type="button" disabled={index === 0} aria-label={`Move block ${index + 1} up`} onClick={() => dispatch({ type: 'moveBlock', list, from: index, to: index - 1 })}>
            Up
          </button>
          <button type="button" disabled={index === count - 1} aria-label={`Move block ${index + 1} down`} onClick={() => dispatch({ type: 'moveBlock', list, from: index, to: index + 1 })}>
            Down
          </button>
          <button type="button" aria-label={`Delete block ${index + 1}`} onClick={() => dispatch({ type: 'removeBlock', list, block: index })}>
            Delete
          </button>
        </span>
      </header>
      <Fields {...props} />
      {problems.length > 0 ? (
        <ul className={styles.problems}>
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

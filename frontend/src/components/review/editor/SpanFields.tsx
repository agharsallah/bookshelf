/**
 * One span group (a paragraph, a list item, a table cell): each span's text, its mark,
 * and its cites as removable chips plus a typeahead to add one.
 */
import type { Dispatch } from 'react';
import { anchorLabel } from '../../../lib/anchors';
import type { Mark, Span } from '../../../lib/contract';
import type { SourceBlock } from '../api';
import { CitePicker } from './CitePicker';
import type { EditorAction, SpanRef } from './reducer';
import styles from './Editor.module.css';

const MARKS: { value: Mark | ''; label: string }[] = [
  { value: '', label: 'Plain' },
  { value: 'strong', label: 'Strong' },
  { value: 'em', label: 'Emphasis' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'code', label: 'Code' },
];

export interface SpanFieldsProps {
  spans: readonly Span[];
  at: Omit<SpanRef, 'span'>;
  label: string;
  dispatch: Dispatch<EditorAction>;
  sources: readonly SourceBlock[];
}

export function SpanFields({ spans, at, label, dispatch, sources }: SpanFieldsProps) {
  return (
    <fieldset className={styles.spans}>
      <legend className="visually-hidden">{label}</legend>
      {spans.map((span, i) => {
        const ref = { ...at, span: i };
        const name = spans.length > 1 ? `${label}, span ${i + 1}` : label;
        return (
          <div key={i} className={styles.span} data-uncited={span.cites.length === 0 || undefined}>
            <textarea
              aria-label={`${name} text`}
              className={styles.spanText}
              value={span.text}
              rows={Math.min(8, Math.max(1, Math.ceil(span.text.length / 70)))}
              onChange={(e) => dispatch({ type: 'editSpan', at: ref, patch: { text: e.target.value } })}
            />
            <div className={styles.spanMeta}>
              <select
                aria-label={`${name} mark`}
                value={span.mark ?? ''}
                onChange={(e) => dispatch({ type: 'editSpan', at: ref, patch: { mark: (e.target.value || undefined) as Mark | undefined } })}
              >
                {MARKS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <ul className={styles.cites} aria-label={`${name} cites`}>
                {span.cites.length === 0 ? <li className={styles.noCite}>uncited</li> : null}
                {span.cites.map((anchor) => (
                  <li key={anchor} className={styles.cite}>
                    <span title={anchor}>{anchorLabel(anchor)}</span>
                    <button
                      type="button"
                      aria-label={`Remove cite ${anchor}`}
                      onClick={() => dispatch({ type: 'removeCite', at: ref, anchor })}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <CitePicker
                blocks={sources}
                exclude={span.cites}
                label={`Add a cite to ${name}`}
                onPick={(anchor) => dispatch({ type: 'addCite', at: ref, anchor })}
              />
              {spans.length > 1 ? (
                <button type="button" className={styles.quiet} onClick={() => dispatch({ type: 'removeSpan', at: ref })}>
                  Remove span
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
      <button type="button" className={styles.quiet} onClick={() => dispatch({ type: 'addSpan', at })}>
        Add a span
      </button>
    </fieldset>
  );
}

/** Cites on the block itself (quote, code, math, chart, diagram). */
export function BlockCites({
  cites,
  list,
  block,
  dispatch,
  sources,
}: {
  cites: readonly string[];
  list: number;
  block: number;
  dispatch: Dispatch<EditorAction>;
  sources: readonly SourceBlock[];
}) {
  return (
    <div className={styles.spanMeta}>
      <ul className={styles.cites} aria-label="Block cites">
        {cites.length === 0 ? <li className={styles.noCite}>uncited</li> : null}
        {cites.map((anchor) => (
          <li key={anchor} className={styles.cite}>
            <span title={anchor}>{anchorLabel(anchor)}</span>
            <button type="button" aria-label={`Remove cite ${anchor}`} onClick={() => dispatch({ type: 'removeBlockCite', list, block, anchor })}>
              ×
            </button>
          </li>
        ))}
      </ul>
      <CitePicker blocks={sources} exclude={cites} onPick={(anchor) => dispatch({ type: 'addBlockCite', list, block, anchor })} />
    </div>
  );
}

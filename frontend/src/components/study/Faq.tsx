/**
 * The FAQ (island): questions under their topic headings, each opening in place to its
 * cited answer and any detail beneath it (steps, a table, the trap to avoid). A filter
 * narrows the list as you type; Expand all / Collapse all act on what is shown.
 */
import { useId, useMemo, useState } from 'react';
import { spansOf as blockSpans } from '../../lib/contract';
import { Blocks } from '../blocks/Blocks';
import { Spans } from '../blocks/Spans';
import { matches, runsOf } from './listing';
import { readerHref, ReaderCites } from './ReaderCites';
import { plainText, type FaqItem } from './study-body';
import styles from './Faq.module.css';
import shared from './Study.module.css';

export interface FaqProps {
  slug: string;
  items: FaqItem[];
}

/** Everything a filter can match in an item: the question, the answer and its detail. */
export function searchText(item: FaqItem): string {
  const detail = item.detail.flatMap((block) => {
    try {
      return blockSpans(block);
    } catch {
      return [];
    }
  });
  return [item.question, plainText(item.answer), plainText(detail)].join(' ');
}

export function Faq({ slug, items }: FaqProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const texts = useMemo(() => items.map(searchText), [items]);
  const shown = items.map((item, index) => ({ item, index })).filter(({ index }) => matches(query, texts[index] ?? ''));
  const runs = runsOf(shown, ({ item }) => item.group);
  const citeHref = useMemo(() => readerHref(slug), [slug]);
  const allOpen = shown.length > 0 && shown.every(({ index }) => open.has(index));

  const toggle = (index: number) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  /** Open or close every question shown, leaving filtered-out ones as they were. */
  const setShownOpen = (value: boolean) => {
    const next = new Set(open);
    for (const { index } of shown) {
      if (value) next.add(index);
      else next.delete(index);
    }
    setOpen(next);
  };

  return (
    <ReaderCites slug={slug}>
      <section className={styles.faq} aria-label="Questions and answers">
        <div className={shared.toolbar}>
          <label className={shared.search}>
            <span className="visually-hidden">Filter the questions</span>
            <input type="search" placeholder="Filter the questions" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <span className={shared.count} aria-live="polite">
            {query ? `${shown.length} of ${items.length} questions` : `${items.length} questions`}
          </span>
          <span className={shared.spacer} />
          <button
            type="button"
            className="btn btn-quiet"
            disabled={shown.length === 0}
            onClick={() => setShownOpen(!allOpen)}
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>

        {shown.length === 0 ? (
          <p className={shared.none}>
            No question mentions “{query}”.{' '}
            <button type="button" className="btn btn-quiet" onClick={() => setQuery('')}>
              Clear the filter
            </button>
          </p>
        ) : (
          runs.map((run, r) => (
            <div key={`${run.group ?? ''}${r}`} className={styles.topic}>
              {run.group ? <h2 className={styles.topicTitle}>{run.group}</h2> : null}
              <div className={styles.sheet}>
                {run.items.map(({ item, index }) => (
                  <Question key={index} item={item} open={open.has(index)} onToggle={() => toggle(index)} citeHref={citeHref} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
    </ReaderCites>
  );
}

interface QuestionProps {
  item: FaqItem;
  open: boolean;
  onToggle: () => void;
  citeHref: (anchor: string) => string;
}

function Question({ item, open, onToggle, citeHref }: QuestionProps) {
  const id = useId();
  return (
    <div className={styles.item} data-open={open ? '' : undefined}>
      <h3 className={styles.question}>
        <button type="button" id={`${id}-q`} aria-expanded={open} aria-controls={`${id}-a`} onClick={onToggle}>
          <span>{item.question}</span>
          <svg className={styles.chevron} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
      </h3>
      <div className={styles.panel} id={`${id}-a`} role="region" aria-labelledby={`${id}-q`} inert={!open}>
        <div className={styles.panelInner}>
          <p className={styles.answer}>
            <Spans spans={item.answer} />
          </p>
          {item.detail.length > 0 ? <Blocks blocks={item.detail} citeHref={citeHref} className={styles.detail} /> : null}
        </div>
      </div>
    </div>
  );
}

export default Faq;

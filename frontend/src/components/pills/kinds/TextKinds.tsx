/**
 * The reading kinds: one idea in large type. Insight (with its why, folded), remember and
 * pitfall in their callout tones, a hook that holds back its payoff, a quote in the
 * book's serif, a definition and a number set huge. Quotes and definitions are the
 * render contract's own blocks.
 */
import { useState } from 'react';
import { Blocks } from '../../blocks/Blocks';
import { Spans } from '../../blocks/Spans';
import { usePillCites } from '../PillCites';
import type { KindProps } from './context';
import styles from './Kinds.module.css';

export function InsightPill({ pill }: KindProps<'insight'>) {
  const { spans, why } = pill.body;
  return (
    <div className={styles.idea} data-tone="insight">
      <p className={styles.lead}>
        <Spans spans={spans} />
      </p>
      {why && why.length > 0 ? (
        <details className={styles.why}>
          <summary>Why it matters</summary>
          <p>
            <Spans spans={why} />
          </p>
        </details>
      ) : null}
    </div>
  );
}

export function RememberPill({ pill }: KindProps<'remember'>) {
  return (
    <div className={styles.idea} data-tone="remember">
      <p className={styles.lead}>
        <Spans spans={pill.body.spans} />
      </p>
    </div>
  );
}

export function AntipatternPill({ pill }: KindProps<'antipattern'>) {
  return (
    <div className={styles.idea} data-tone="antipattern">
      <p className={styles.lead}>
        <Spans spans={pill.body.spans} />
      </p>
    </div>
  );
}

export function HookPill({ pill }: KindProps<'hook'>) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.idea}>
      <p className={styles.lead}>
        <Spans spans={pill.body.spans} />
      </p>
      {open ? (
        <p className={styles.payoff}>
          <Spans spans={pill.body.payoff} />
        </p>
      ) : (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Tell me
        </button>
      )}
    </div>
  );
}

export function QuotePill({ pill }: KindProps<'quote'>) {
  const cite = usePillCites(pill, pill.document.slug);
  const { text, page, attribution } = pill.body;
  const block = { type: 'quote' as const, text, page: page ?? null, cites: pill.cites, ...(attribution ? { attribution } : {}) };
  return (
    <div className={styles.quote}>
      <Blocks blocks={[block]} {...cite} />
    </div>
  );
}

export function DefinitionPill({ pill }: KindProps<'definition'>) {
  const cite = usePillCites(pill, pill.document.slug);
  return (
    <div className={styles.definition}>
      <Blocks blocks={[{ type: 'definition', term: pill.body.term, spans: pill.body.spans }]} {...cite} />
    </div>
  );
}

export function NumberPill({ pill }: KindProps<'number'>) {
  return (
    <div className={styles.number}>
      <p className={styles.value}>{pill.body.value}</p>
      <p className={styles.label}>
        <Spans spans={pill.body.label} />
      </p>
    </div>
  );
}

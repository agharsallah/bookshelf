/**
 * One pill, as an `<article>`: the source chip (the book's spine colour, its unit, the
 * kind), the headline, the idea, its cite chips (they open the passage in the guide's
 * drawer), and the rail — Save, Read, More, Huh, Too easy. A thread shows where it is
 * and steps sideways.
 */
import type { CSSProperties } from 'react';
import { isActive, type Pill } from '../../lib/pills/types';
import { BlockSources } from '../blocks/CiteChip';
import { Kbd } from '../study/ReaderCites';
import { PillBody, type KindContext } from './kinds';
import { citeReaderHref, documentDye, KIND_LABELS, primarySource } from './model';
import { PillCites } from './PillCites';
import { pillsHref } from '../../lib/pills/config';
import styles from './PillCard.module.css';

export type Reaction = 'too_easy' | 'confusing';

export interface PillCardProps {
  pill: Pill;
  ctx: KindContext;
  saved: boolean;
  reacted: Reaction | null;
  onSave: () => void;
  onReact: (reaction: Reaction) => void;
  onOpenSource: () => void;
  /** Where it stands in the feed, for `aria-posinset`. */
  position: number;
  /** Pills in the session, or -1 when endless. */
  setSize: number;
  /** Within a thread: step sideways. */
  thread?: { step: number; size: number; title: string | null; onStep: (delta: 1 | -1) => void } | undefined;
}

export function PillCard({ pill, ctx, saved, reacted, onSave, onReact, onOpenSource, position, setSize, thread }: PillCardProps) {
  const headingId = `pill-${pill.id}`;
  const source = primarySource(pill);
  const concept = pill.concepts[0];
  const style = { '--dye': documentDye(pill.document) } as CSSProperties;
  return (
    <article className={styles.pill} aria-labelledby={headingId} aria-posinset={position + 1} aria-setsize={setSize} data-kind={pill.kind} style={style}>
      <div className={styles.main}>
        <header className={styles.head}>
          <a className={styles.chip} href={citeReaderHref({ slug: pill.document.slug, anchor: pill.anchor })}>
            <span className={styles.spine} aria-hidden="true" />
            <span className={styles.book}>{pill.document.title}</span>
            {pill.unit_title ? <span className={styles.unit}>{pill.unit_title}</span> : null}
          </a>
          <span className={styles.kind} data-active={isActive(pill) ? '' : undefined}>
            {KIND_LABELS[pill.kind]}
          </span>
          {pill.draft ? <span className={styles.draft} title="From material not yet reviewed">Draft</span> : null}
        </header>

        {thread ? (
          <nav className={styles.thread} aria-label="Thread">
            <button type="button" className={styles.step} onClick={() => thread.onStep(-1)} disabled={thread.step === 0} aria-label="Previous in thread" aria-keyshortcuts="ArrowLeft">
              ‹
            </button>
            <span className={styles.threadTitle}>
              {thread.title ? `${thread.title} · ` : ''}
              {thread.step + 1} of {thread.size}
            </span>
            <span className={styles.dots} aria-hidden="true">
              {Array.from({ length: thread.size }, (_, i) => (
                <span key={i} data-on={i === thread.step ? '' : undefined} />
              ))}
            </span>
            <button type="button" className={styles.step} onClick={() => thread.onStep(1)} disabled={thread.step >= thread.size - 1} aria-label="Next in thread" aria-keyshortcuts="ArrowRight">
              ›
            </button>
          </nav>
        ) : null}

        <h2 id={headingId} className={pill.headline ? styles.headline : 'visually-hidden'}>
          {pill.headline ?? `${KIND_LABELS[pill.kind]} from ${pill.document.title}`}
        </h2>

        <PillCites pill={pill} slug={pill.document.slug} onOpen={onOpenSource}>
          <div className={styles.body}>
            <PillBody pill={pill} ctx={ctx} />
          </div>
          {pill.cites.length > 0 && pill.kind !== 'quote' ? (
            <footer className={styles.sources}>
              <BlockSources anchors={pill.cites} />
            </footer>
          ) : null}
        </PillCites>
      </div>

      <div className={styles.rail} role="group" aria-label="Pill actions">
        <button type="button" className={styles.action} aria-pressed={saved} onClick={onSave} aria-keyshortcuts="s">
          <span aria-hidden="true">{saved ? '★' : '☆'}</span>
          {saved ? 'Saved' : 'Save'} <Kbd>s</Kbd>
        </button>
        <a className={styles.action} href={citeReaderHref(source)} aria-keyshortcuts="o">
          <span aria-hidden="true">❡</span>
          Read <Kbd>o</Kbd>
        </a>
        {concept ? (
          <a className={styles.action} href={pillsHref({ sources: { concepts: [concept] }, mode: 'explore' })} title={`More pills on ${concept}`}>
            <span aria-hidden="true">⋯</span>
            More
          </a>
        ) : null}
        <button type="button" className={styles.action} aria-pressed={reacted === 'confusing'} onClick={() => onReact('confusing')} aria-keyshortcuts="?">
          <span aria-hidden="true">?</span>
          Huh <Kbd>?</Kbd>
        </button>
        <button type="button" className={styles.action} aria-pressed={reacted === 'too_easy'} onClick={() => onReact('too_easy')} aria-keyshortcuts="e">
          <span aria-hidden="true">✓</span>
          Too easy <Kbd>e</Kbd>
        </button>
      </div>
    </article>
  );
}

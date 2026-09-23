/**
 * The right pane: what the shelf knows about this chapter, in tabs — the chapter
 * distillation, the summary, section notes, explanations of figures/tables/code,
 * and your notes. Unapproved artifacts carry a "draft" badge. Unless locked, the
 * pane follows the section being read on the left.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { RenderBlock } from '../../lib/contract';
import { isUnder } from '../../lib/documents/tree';
import { Blocks } from '../blocks/Blocks';
import { scrollPaneTo } from './dom';
import type { PaneEntry, Panes } from './panes';
import styles from './DistillPane.module.css';

export const TABS = ['distillation', 'summary', 'sections', 'figures', 'notes'] as const;
export type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  distillation: 'Distillation',
  summary: 'Summary',
  sections: 'Section notes',
  figures: 'Figures',
  notes: 'Your notes',
};

export interface DistillPaneProps {
  panes: Panes;
  tab: Tab;
  onTab: (tab: Tab) => void;
  notesCount: number;
  notes: ReactNode;
  activeAnchor: string | null;
  activeSection: string | null;
  locked: boolean;
  paneRef: RefObject<HTMLDivElement | null>;
  onCite: (anchor: string) => void;
  citeHref: (anchor: string) => string;
}

function Badge({ entry }: { entry: PaneEntry }) {
  if (entry.standing === 'approved') return null;
  return (
    <a className={styles.badge} href="/review" data-standing={entry.standing}>
      {entry.standing === 'needs_review' ? 'Draft, flagged for review' : 'Draft, not reviewed yet'}
    </a>
  );
}

function Entry({ entry, heading, onCite, citeHref }: { entry: PaneEntry; heading: boolean } & Pick<DistillPaneProps, 'onCite' | 'citeHref'>) {
  return (
    <section className={styles.entry} data-scope={entry.anchor}>
      {heading ? (
        <h3 className={styles.entryTitle}>
          <button type="button" className={styles.scope} onClick={() => onCite(entry.anchor)}>
            {anchorLabel(entry.anchor)}
          </button>
          {entry.title ?? ''}
        </h3>
      ) : null}
      <Badge entry={entry} />
      <Blocks blocks={entry.blocks as RenderBlock[]} onCite={onCite} citeHref={citeHref} />
    </section>
  );
}

const EMPTY: Record<Exclude<Tab, 'notes'>, string> = {
  distillation: 'No distillation yet. It is written from the section notes once they exist.',
  summary: 'No summary yet. Queue one from the document page.',
  sections: 'No section notes yet.',
  figures: 'No figures, tables or code explained in this chapter yet.',
};

export function DistillPane(props: DistillPaneProps) {
  const { panes, tab, onTab, activeAnchor, activeSection, locked, paneRef } = props;
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const available: Record<Tab, number> = {
    distillation: panes.distillation ? 1 : 0,
    summary: panes.summary ? 1 : 0,
    sections: panes.sections.length,
    figures: panes.figures.length,
    notes: props.notesCount,
  };

  // Follow the reading position: scroll to the first thing citing the active section.
  useEffect(() => {
    const pane = paneRef.current;
    if (locked || !pane || !activeSection || tab === 'notes') return;
    const scopes = [...pane.querySelectorAll<HTMLElement>('[data-scope]')];
    const scoped = scopes.find((el) => activeAnchor !== null && isUnder(activeAnchor, el.dataset.scope ?? '~'));
    const chip = [...pane.querySelectorAll<HTMLElement>('[data-anchor]')].find((el) => isUnder(el.dataset.anchor ?? '', activeSection));
    const target = tab === 'distillation' || tab === 'summary' ? chip?.closest('[data-block]') : (scoped ?? chip?.closest('[data-scope]'));
    if (target) scrollPaneTo(pane, target);
  }, [activeSection, activeAnchor, tab, locked, paneRef]);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length] ?? tab;
    onTab(next);
    tabRefs.current[next]?.focus();
  };

  const single = tab === 'distillation' ? panes.distillation : tab === 'summary' ? panes.summary : null;
  const list = tab === 'sections' ? panes.sections : tab === 'figures' ? panes.figures : [];

  return (
    <div className={styles.pane}>
      <div className={styles.tabs} role="tablist" aria-label="About this chapter" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls="distill-panel"
            tabIndex={tab === t ? 0 : -1}
            className={styles.tab}
            data-empty={available[t] === 0 ? '' : undefined}
            onClick={() => onTab(t)}
          >
            {TAB_LABELS[t]}
            {t === 'notes' || t === 'sections' || t === 'figures' ? <span className={styles.count}>{available[t]}</span> : null}
          </button>
        ))}
      </div>
      <div className={styles.scroll} ref={paneRef} role="tabpanel" id="distill-panel" aria-labelledby={`tab-${tab}`} tabIndex={0}>
        {tab === 'notes' ? (
          props.notes
        ) : single ? (
          <Entry entry={single} heading={false} onCite={props.onCite} citeHref={props.citeHref} />
        ) : list.length > 0 ? (
          list.map((entry) => <Entry key={entry.id} entry={entry} heading onCite={props.onCite} citeHref={props.citeHref} />)
        ) : (
          <p className={styles.empty}>{EMPTY[tab]}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The right pane: what the shelf knows about this chapter, in tabs — the chapter
 * distillation, the summary, section notes, the chapter's original figures with
 * the explanations made of them (and of its tables and code), and your notes. Unapproved artifacts carry a "draft" badge. The pane stays put
 * unless following is turned on, then it tracks the section being read on the left. Passages of the distillation and
 * summary can be highlighted and annotated, like the source text.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { anchorLabel } from '../../lib/anchors';
import type { RenderBlock } from '../../lib/contract';
import { isUnder } from '../../lib/documents/tree';
import { Blocks } from '../blocks/Blocks';
import type { MagnifyHandler } from '../blocks/MagnifyContext';
import { scrollPaneTo } from './dom';
import type { FigureShelfItem } from './figures';
import { OriginalFigureView } from './OriginalFigureView';
import { NOTABLE_ATTR, NOTABLE_TARGET_ATTR } from './paneMarks';
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
  /** Open a drawn figure (diagram, chart) in the lightbox. */
  onMagnify: MagnifyHandler;
  /** The Figures tab: originals paired with their explanations (figures.ts `figureShelf`). */
  figures: readonly FigureShelfItem<PaneEntry>[];
  /** Open one of the chapter's original figures in the lightbox. */
  onOpenFigure: (anchor: string) => void;
}

function Badge({ entry }: { entry: PaneEntry }) {
  if (entry.standing === 'approved') return null;
  return (
    <a className={styles.badge} href="/review" data-standing={entry.standing}>
      {entry.standing === 'needs_review' ? 'Draft, flagged for review' : 'Draft, not reviewed yet'}
    </a>
  );
}

/** The distillation and summary take highlights and notes (paneMarks.ts). */
const NOTABLE_TYPES = new Set(['chapter_distillation', 'chapter_summary']);

type EntryActions = Pick<DistillPaneProps, 'onCite' | 'citeHref' | 'onMagnify'>;

function EntryTitle({ anchor, title, onCite }: { anchor: string; title: string | null; onCite: (anchor: string) => void }) {
  return (
    <h3 className={styles.entryTitle}>
      <button type="button" className={styles.scope} onClick={() => onCite(anchor)}>
        {anchorLabel(anchor)}
      </button>
      {title ?? ''}
    </h3>
  );
}

function Entry({ entry, heading, onCite, citeHref, onMagnify }: { entry: PaneEntry; heading: boolean } & EntryActions) {
  const notable = NOTABLE_TYPES.has(entry.type);
  return (
    <section
      className={styles.entry}
      data-scope={entry.anchor}
      {...(notable ? { [NOTABLE_ATTR]: entry.id, [NOTABLE_TARGET_ATTR]: entry.type } : {})}
    >
      {heading ? <EntryTitle anchor={entry.anchor} title={entry.title} onCite={onCite} /> : null}
      <Badge entry={entry} />
      <Blocks blocks={entry.blocks as RenderBlock[]} onCite={onCite} citeHref={citeHref} onMagnify={onMagnify} />
    </section>
  );
}

/** An original figure over the explanation mapped to it; a table or code explanation alone. */
function FigureEntry({ item, onOpenFigure, ...actions }: { item: FigureShelfItem<PaneEntry> } & EntryActions & Pick<DistillPaneProps, 'onOpenFigure'>) {
  const { anchor, original, explanation } = item;
  if (!original) return explanation ? <Entry entry={explanation} heading {...actions} /> : null;
  return (
    <section className={styles.entry} data-scope={anchor}>
      <EntryTitle anchor={anchor} title={explanation?.title ?? original.caption ?? `Figure ${original.n}`} onCite={actions.onCite} />
      <OriginalFigureView anchor={anchor} figure={original} explained={explanation !== null} onOpen={onOpenFigure} onShow={actions.onCite} />
      {explanation ? (
        <>
          <Badge entry={explanation} />
          <Blocks blocks={explanation.blocks as RenderBlock[]} onCite={actions.onCite} citeHref={actions.citeHref} onMagnify={actions.onMagnify} />
        </>
      ) : null}
    </section>
  );
}

const EMPTY: Record<Exclude<Tab, 'notes'>, string> = {
  distillation: 'No distillation yet. It is written from the section notes once they exist.',
  summary: 'No summary yet. Queue one from the document page.',
  sections: 'No section notes yet.',
  figures: 'No figures in this chapter, and no tables or code explained yet.',
};

export function DistillPane(props: DistillPaneProps) {
  const { panes, tab, onTab, activeAnchor, activeSection, locked, paneRef } = props;
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const available: Record<Tab, number> = {
    distillation: panes.distillation ? 1 : 0,
    summary: panes.summary ? 1 : 0,
    sections: panes.sections.length,
    figures: props.figures.length,
    notes: props.notesCount,
  };

  // Clicking a cite chip scrolls the source, which moves the active section; the pane must
  // stay put then, since that click came from the pane. Hold the follow until the jump settles.
  const holdFollow = useRef(false);
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-anchor]')) return;
      holdFollow.current = true;
      clearTimeout(timer);
      timer = setTimeout(() => (holdFollow.current = false), 1500);
    };
    pane.addEventListener('click', onClick, true);
    return () => {
      pane.removeEventListener('click', onClick, true);
      clearTimeout(timer);
    };
  }, [paneRef]);

  // Follow the reading position: scroll to the first thing citing the active section.
  useEffect(() => {
    const pane = paneRef.current;
    if (holdFollow.current) return;
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
  const actions: EntryActions = { onCite: props.onCite, citeHref: props.citeHref, onMagnify: props.onMagnify };

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
          <Entry entry={single} heading={false} {...actions} />
        ) : tab === 'sections' && panes.sections.length > 0 ? (
          panes.sections.map((entry) => <Entry key={entry.id} entry={entry} heading {...actions} />)
        ) : tab === 'figures' && props.figures.length > 0 ? (
          props.figures.map((item) => <FigureEntry key={item.anchor} item={item} onOpenFigure={props.onOpenFigure} {...actions} />)
        ) : (
          <p className={styles.empty}>{EMPTY[tab]}</p>
        )}
      </div>
    </div>
  );
}

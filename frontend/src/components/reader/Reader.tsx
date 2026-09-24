/**
 * The reader island: one chapter, source blocks on the left and what the shelf
 * knows about them on the right, kept in step as you scroll (unless locked).
 * Cite chips scroll to and flash their passage; hovering a passage lights up what
 * cites it. Select text to highlight or annotate it. The URL follows the block in
 * view so any position can be shared.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { TreeNode } from '../../lib/api/types/documents';
import type { HighlightColor } from '../../lib/contract';
import { toCodePointRange, toUtf16Range } from '../../lib/codepoints';
import { flatten } from '../../lib/documents/tree';
import { useAnchorSync } from '../../lib/hooks/useAnchorSync';
import { NoteComposer, type ComposerTarget } from '../notes/NoteComposer';
import { NotesPanel } from '../notes/NotesPanel';
import { useNotes } from '../notes/useNotes';
import { DistillPane, type Tab } from './DistillPane';
import { revealBlock, SOURCE_ATTR } from './dom';
import { groupMarks, marksFor, notedBlocks, type MarksByAnchor } from './marks';
import { Navigator, type NavSection, type NavUnit } from './Navigator';
import type { Panes } from './panes';
import { SourceBlock } from './SourceBlock';
import { useReaderEvents } from './useReaderEvents';
import styles from './Reader.module.css';

export interface ReaderProps {
  document: { id: string; slug: string; title: string };
  unit: TreeNode;
  units: NavUnit[];
  panes: Panes;
  notes: NoteDetail[];
  codeHtml: Record<string, string>;
  initialAnchor: string | null;
  truncated: boolean;
}

function firstTab(panes: Panes): Tab {
  if (panes.distillation) return 'distillation';
  if (panes.summary) return 'summary';
  if (panes.sections.length) return 'sections';
  return 'distillation';
}

export function Reader({ document: doc, unit, units, panes, notes: initialNotes, codeHtml, initialAnchor, truncated }: ReaderProps) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(() => firstTab(panes));
  const [locked, setLocked] = useState(false);
  const [view, setView] = useState<'source' | 'distil'>('source');
  const [contentsOpen, setContentsOpen] = useState(false);
  const [composer, setComposer] = useState<{ target: ComposerTarget; compose: boolean } | null>(null);
  const [focusedNote, setFocusedNote] = useState<string | null>(null);
  const { notes: wireNotes, saving, add, annotate, recolor, remove, review } = useNotes(initialNotes);

  const flat = useMemo(() => flatten(unit), [unit]);
  const anchors = useMemo(() => flat.map((f) => f.node.anchor), [flat]);
  const order = useMemo(() => new Map(anchors.map((a, i) => [a, i])), [anchors]);
  const texts = useMemo(() => new Map(flat.map((f) => [f.node.anchor, f.node.text ?? ''])), [flat]);
  // Ranges are code points on the wire and UTF-16 offsets in the DOM (lib/codepoints).
  const notes = useMemo(
    () => wireNotes.map((n) => (n.range ? { ...n, range: toUtf16Range(texts.get(n.anchor) ?? '', n.range) } : n)),
    [wireNotes, texts],
  );
  const sectionOf = useMemo(() => new Map(flat.map((f) => [f.node.anchor, f.section])), [flat]);
  const pages = useMemo(() => {
    let last: number | null = null;
    return flat.map(({ node }) => {
      const page = node.page_from;
      const show = page !== null && page !== last && node.kind !== 'section';
      if (page !== null && node.kind !== 'section') last = page;
      return show ? page : null;
    });
  }, [flat]);
  const navSections: NavSection[] = useMemo(
    () =>
      flat
        .filter((f) => f.node.kind === 'section')
        .map((f) => ({ anchor: f.node.anchor, heading: f.node.heading ?? '', level: f.node.depth - unit.depth })),
    [flat, unit.depth],
  );

  const marksCache = useRef<MarksByAnchor>(new Map());
  const marks = useMemo(() => {
    marksCache.current = groupMarks(notes, marksCache.current);
    return marksCache.current;
  }, [notes]);
  const blockNotes = useMemo(() => notedBlocks(notes), [notes]);

  const active = useAnchorSync(sourceRef, SOURCE_ATTR, [flat.length]);
  const activeSection = active ? (sectionOf.get(active) ?? null) : null;
  const progress = active ? ((order.get(active) ?? 0) + 1) / Math.max(1, anchors.length) : 0;

  const readHref = useCallback((anchor: string) => `/documents/${doc.slug}/read/${anchor}`, [doc.slug]);
  const index = units.findIndex((u) => u.anchor === unit.anchor);
  const prev = units[index - 1] ?? null;
  const next = units[index + 1] ?? null;

  // A shared link keeps its anchor until the reader moves on their own.
  const holdUrl = useRef(Boolean(initialAnchor));
  useEffect(() => {
    const release = () => {
      holdUrl.current = false;
    };
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    events.forEach((e) => window.addEventListener(e, release, { once: true, passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, release));
  }, []);

  // The URL follows the block in view (replaceState, so history is not flooded).
  useEffect(() => {
    if (!active || holdUrl.current) return;
    const timer = setTimeout(() => window.history.replaceState(window.history.state, '', readHref(active)), 250);
    return () => clearTimeout(timer);
  }, [active, readHref]);

  // Land on the anchor from the URL.
  useEffect(() => {
    if (initialAnchor && initialAnchor !== unit.anchor && sourceRef.current) revealBlock(sourceRef.current, initialAnchor);
  }, [initialAnchor, unit.anchor]);

  const onCite = useCallback(
    (anchor: string) => {
      setView('source');
      if (!sourceRef.current || !revealBlock(sourceRef.current, anchor)) window.location.assign(readHref(anchor));
    },
    [readHref],
  );

  const openNote = useCallback((id: string) => {
    setTab('notes');
    setView('distil');
    setFocusedNote(id);
    requestAnimationFrame(() => paneRef.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.focus());
  }, []);

  useReaderEvents({
    sourceRef,
    paneRef,
    anchors,
    activeAnchor: active,
    linkFor: readHref,
    prevHref: prev ? readHref(prev.anchor) : null,
    nextHref: next ? readHref(next.anchor) : null,
    onSelect: (target) => setComposer((current) => (current?.compose ? current : target ? { target, compose: false } : null)),
    onCompose: (target) => setComposer({ target, compose: true }),
    onEscape: () => {
      setComposer(null);
      setContentsOpen(false);
    },
    onNoteClick: openNote,
  });

  /** `raw` null: a plain highlight (no words, no model call). */
  const save = async (raw: string | null, color: HighlightColor | null) => {
    if (!composer) return;
    const { target } = composer;
    const range = target.range ? toCodePointRange(texts.get(target.anchor) ?? '', target.range) : null;
    const created = await add({ documentId: doc.id, anchor: target.anchor, range, raw, color });
    if (created) {
      setComposer(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const navigator = (
    <Navigator
      slug={doc.slug}
      units={units}
      current={unit.anchor}
      sections={navSections}
      activeSection={activeSection}
      progress={progress}
      onSection={(anchor) => {
        setContentsOpen(false);
        if (sourceRef.current) revealBlock(sourceRef.current, anchor);
      }}
    />
  );

  return (
    <div className={styles.reader} data-view={view}>
      <div className={styles.toolbar}>
        <div className={styles.titles}>
          <a className={styles.book} href={`/documents/${doc.slug}`}>
            {doc.title}
          </a>
          <h1 className={styles.chapter}>{unit.heading ?? unit.anchor}</h1>
        </div>
        <div className={styles.controls}>
          <button type="button" className={styles.contentsButton} aria-expanded={contentsOpen} onClick={() => setContentsOpen((o) => !o)}>
            Contents
          </button>
          <div className={styles.viewSwitch} role="group" aria-label="Show">
            <button type="button" aria-pressed={view === 'source'} onClick={() => setView('source')}>
              Text
            </button>
            <button type="button" aria-pressed={view === 'distil'} onClick={() => setView('distil')}>
              Distillation
            </button>
          </div>
          <button type="button" className={styles.lock} aria-pressed={locked} onClick={() => setLocked((l) => !l)} title="Keep the right pane where it is while you scroll">
            {locked ? 'Unlock pane' : 'Lock pane'}
          </button>
          <span className={styles.chapterNav}>
            {prev ? <a href={readHref(prev.anchor)} aria-label={`Previous chapter: ${prev.heading}`} title="Previous chapter ([)">‹</a> : null}
            {next ? <a href={readHref(next.anchor)} aria-label={`Next chapter: ${next.heading}`} title="Next chapter (])">›</a> : null}
          </span>
        </div>
        {contentsOpen ? <div className={styles.contentsPopover}>{navigator}</div> : null}
      </div>

      <div className={styles.columns}>
        <aside className={styles.navColumn}>{navigator}</aside>

        <article className={styles.source} ref={sourceRef} aria-label="Text">
          {truncated ? <p className={styles.notice}>This chapter is very long; only its first 2,000 blocks are shown.</p> : null}
          {flat.length === 0 ? <p className={styles.notice}>This chapter has no text blocks.</p> : null}
          {flat.map(({ node }, i) => (
            <SourceBlock
              key={node.anchor}
              node={node}
              marks={marksFor(marks, node.anchor)}
              page={pages[i] ?? null}
              codeHtml={codeHtml[node.anchor]}
              hasBlockNote={blockNotes.has(node.anchor)}
              level={node.depth - unit.depth}
            />
          ))}
          <footer className={styles.end}>
            {next ? (
              <a href={readHref(next.anchor)}>Next: {next.heading}</a>
            ) : (
              <a href={`/documents/${doc.slug}`}>Back to the document</a>
            )}
          </footer>
        </article>

        <div className={styles.distil}>
          <DistillPane
            panes={panes}
            tab={tab}
            onTab={setTab}
            notesCount={notes.length}
            activeAnchor={active}
            activeSection={activeSection}
            locked={locked}
            paneRef={paneRef}
            onCite={onCite}
            citeHref={readHref}
            notes={
              <NotesPanel
                notes={notes}
                order={order}
                texts={texts}
                focusedId={focusedNote}
                onReveal={onCite}
                onCite={onCite}
                onColor={(note, color) => void recolor(note, color)}
                onAddWords={annotate}
                onDelete={(note) => void remove(note)}
                onReview={(note, action) => void review(note, action)}
              />
            }
          />
        </div>
      </div>

      {composer ? (
        <NoteComposer
          key={`${composer.target.anchor}:${composer.target.range?.start ?? 'b'}:${composer.compose}`}
          target={composer.target}
          startComposing={composer.compose}
          saving={saving}
          onHighlight={(color) => void save(null, color)}
          onSave={(raw, color) => void save(raw, color)}
          onClose={() => setComposer(null)}
        />
      ) : null}
    </div>
  );
}

export default Reader;

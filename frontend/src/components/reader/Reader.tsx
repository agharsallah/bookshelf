/**
 * The reader island: one chapter, source blocks on the left and what the shelf
 * knows about them on the right, kept in step as you scroll (unless locked).
 * Cite chips scroll to and flash their passage; hovering a passage lights up what
 * cites it. Select text (of the source, the distillation or the summary) to highlight
 * or annotate it; your notes list covers the chapter or the whole book. The URL follows the block in
 * view so any position can be shared, and your place in the chapter is saved as you read.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { TreeNode } from '../../lib/api/types/documents';
import type { HighlightColor } from '../../lib/contract';
import { toCodePointRange, toUtf16Range } from '../../lib/codepoints';
import { flatten, isUnder, pageMarkers } from '../../lib/documents/tree';
import { useAnchorSync } from '../../lib/hooks/useAnchorSync';
import { NoteComposer, type ComposerTarget } from '../notes/NoteComposer';
import { NotesPanel, type NotesScope } from '../notes/NotesPanel';
import { useNotes } from '../notes/useNotes';
import { DistillPane, type Tab } from './DistillPane';
import { revealBlock, sourceBlock, SOURCE_ATTR } from './dom';
import { paintPaneNotes, paneNoteAt, revealPaneNote } from './paneMarks';
import { groupMarks, marksFor, notedBlocks, type MarksByAnchor } from './marks';
import { ShortcutHelp } from '../common/ShortcutHelp';
import { Navigator, type NavSection, type NavUnit } from './Navigator';
import type { Panes } from './panes';
import { minutesLeft, timeLeftLabel, wordCount } from './progress';
import { figureItems } from './figures';
import { canDragMeasure, isCentred, readerLayout } from './layout';
import { MeasureHandle } from './MeasureHandle';
import { clampSize, prefsVars, WIDTH_REM } from './prefs';
import { ReaderToolbar, type ReaderView } from './ReaderToolbar';
import { ReadingSettings } from './ReadingSettings';
import { SourceBlock } from './SourceBlock';
import { useReaderPrefs } from './usePrefs';
import { actionFor, READER_SHORTCUTS, type ReaderAction } from './shortcuts';
import { useFigureLightbox } from './useFigureLightbox';
import { useFollowUrl } from './useFollowUrl';
import { useReaderEvents } from './useReaderEvents';
import { useSavePosition } from './useSavePosition';
import { useAutoHide, useFocusChrome, useFullscreen, useMediaQuery } from './useReaderLayout';
import styles from './Reader.module.css';

export interface ReaderProps {
  document: { id: string; slug: string; title: string };
  unit: TreeNode;
  units: NavUnit[];
  panes: Panes;
  /** Every note in the book: the chapter's are shown in place, the rest in the notes list. */
  notes: NoteDetail[];
  codeHtml: Record<string, string>;
  initialAnchor: string | null;
  truncated: boolean;
}

/** Where the contents rail fits beside the text, and where one pane shows at a time (Reader.module.css). */
const WIDE_QUERY = '(min-width: 90.0625rem)';
const NARROW_QUERY = '(max-width: 56rem)';

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
  const [view, setView] = useState<ReaderView>('source');
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [prefs, setPrefs] = useReaderPrefs();
  const [composer, setComposer] = useState<{ target: ComposerTarget; compose: boolean } | null>(null);
  const [focusedNote, setFocusedNote] = useState<string | null>(null);
  const [notesScope, setNotesScope] = useState<NotesScope>('chapter');
  const composerHost = useRef<HTMLDivElement>(null);
  const contentsButton = useRef<HTMLButtonElement>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const fullscreen = useFullscreen();
  useFocusChrome(prefs.focus);
  const toolbarHidden = useAutoHide(prefs.focus, contentsOpen || settingsOpen || composer !== null);
  // Focus mode sets both panes aside without forgetting whether they were shown.
  const showRail = prefs.contents && !prefs.focus;
  const showPane = prefs.pane && !prefs.focus;
  // Rendered on the server as the wide, two-pane layout; the real screen applies on hydration.
  const wide = useMediaQuery(WIDE_QUERY, true);
  const narrow = useMediaQuery(NARROW_QUERY, false);
  const layout = readerLayout({ rail: showRail, pane: showPane, focus: prefs.focus, wide, narrow });
  const readerRef = useRef<HTMLDivElement>(null);
  const { notes: wireNotes, saving, add, annotate, recolor, remove, review } = useNotes(initialNotes);

  const flat = useMemo(() => flatten(unit), [unit]);
  const anchors = useMemo(() => flat.map((f) => f.node.anchor), [flat]);
  const order = useMemo(() => new Map(anchors.map((a, i) => [a, i])), [anchors]);
  const texts = useMemo(() => new Map(flat.map((f) => [f.node.anchor, f.node.text ?? ''])), [flat]);
  const chapterNotes = useMemo(() => wireNotes.filter((n) => isUnder(n.anchor, unit.anchor)), [wireNotes, unit.anchor]);
  // Ranges are code points on the wire and UTF-16 offsets in the DOM (lib/codepoints).
  const notes = useMemo(
    () =>
      chapterNotes
        .filter((n) => n.target === 'source')
        .map((n) => (n.range ? { ...n, range: toUtf16Range(texts.get(n.anchor) ?? '', n.range) } : n)),
    [chapterNotes, texts],
  );
  // Notes on the distillation and summary are painted over the pane (paneMarks.ts).
  const paneNotes = useMemo(() => chapterNotes.filter((n) => n.target !== 'source' && !n.detached), [chapterNotes]);
  const currentArtifacts = useMemo(
    () => new Set([panes.distillation?.id, panes.summary?.id].filter((id): id is string => Boolean(id))),
    [panes.distillation, panes.summary],
  );
  const sectionOf = useMemo(() => new Map(flat.map((f) => [f.node.anchor, f.section])), [flat]);
  const pages = useMemo(() => pageMarkers(flat), [flat]);
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
  const figures = useMemo(() => figureItems(flat.map((f) => f.node)), [flat]);
  const words = useMemo(() => flat.map(({ node }) => wordCount(node.text ?? '')), [flat]);
  const timeLeft = timeLeftLabel(minutesLeft(words, active ? (order.get(active) ?? 0) : 0));

  // The block being read carries `data-active`, for the spotlight. Set on the DOM so no block re-renders.
  useEffect(() => {
    const el = active && sourceRef.current ? sourceBlock(sourceRef.current, active) : null;
    el?.setAttribute('data-active', '');
    return () => el?.removeAttribute('data-active');
  }, [active]);

  useEffect(() => (paneRef.current ? paintPaneNotes(paneRef.current, paneNotes) : undefined), [paneNotes, tab, view]);

  const readHref = useCallback((anchor: string) => `/documents/${doc.slug}/read/${anchor}`, [doc.slug]);
  const index = units.findIndex((u) => u.anchor === unit.anchor);
  const prev = units[index - 1] ?? null;
  const next = units[index + 1] ?? null;

  useFollowUrl(active, readHref, initialAnchor);
  useSavePosition(doc.slug, unit.anchor, active, progress);

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
  const { openFigure, openDrawing, open: lightboxOpen, lightbox } = useFigureLightbox(figures, onCite);

  const openNote = useCallback((id: string) => {
    setTab('notes');
    setView('distil');
    setFocusedNote(id);
    requestAnimationFrame(() => paneRef.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.focus());
  }, []);

  /** Show what a note marks: its passage in the text, its block on the pane, or its chapter. */
  const revealNote = (note: NoteDetail) => {
    if (note.target === 'source') return onCite(note.anchor);
    if (!isUnder(note.anchor, unit.anchor)) return window.location.assign(readHref(note.anchor));
    setView('distil');
    setTab(note.target === 'chapter_summary' ? 'summary' : 'distillation');
    requestAnimationFrame(() => {
      if (paneRef.current) revealPaneNote(paneRef.current, note);
    });
  };

  /** Close the composer; if focus was in it (or already lost), hand it back to its block. */
  const closeComposer = () => {
    const active = window.document.activeElement;
    const lost = !active || active === window.document.body || Boolean(composerHost.current?.contains(active));
    const block = composer && sourceRef.current ? sourceBlock(sourceRef.current, composer.target.anchor) : null;
    if (lost) block?.focus({ preventScroll: true });
    setComposer(null);
  };

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
      if (helpOpen || lightboxOpen) return;
      if (!composer && !contentsOpen && !settingsOpen && prefs.focus) setPrefs({ focus: false });
      closeComposer();
      if (contentsOpen) contentsButton.current?.focus();
      if (settingsOpen) settingsButton.current?.focus();
      setContentsOpen(false);
      setSettingsOpen(false);
    },
    onAction: (event) => {
      const action = helpOpen || lightboxOpen ? null : actionFor(event);
      if (action) runAction(action);
      return action !== null;
    },
    onNoteClick: openNote,
    onMagnify: openFigure,
    onPaneClick: (x, y) => {
      const id = paneNoteAt(paneNotes, x, y);
      if (id) openNote(id);
    },
  });

  /** A shortcut or toolbar action; `t` and `d` fall back to the popover and view switch where the panes don't fit. */
  function runAction(action: ReaderAction) {
    switch (action) {
      case 'focus':
        setPrefs((p) => ({ focus: !p.focus }));
        break;
      case 'fullscreen':
        fullscreen.toggle();
        break;
      case 'contents':
        if (!prefs.focus && wide) setPrefs((p) => ({ contents: !p.contents }));
        else setContentsOpen((o) => !o);
        break;
      case 'pane':
        if (narrow) setView((v) => (v === 'source' ? 'distil' : 'source'));
        else setPrefs((p) => (p.focus ? { focus: false, pane: true } : { pane: !p.pane }));
        break;
      case 'semantic':
        setPrefs((p) => ({ semantic: !p.semantic }));
        break;
      case 'spotlight':
        setPrefs((p) => ({ spotlight: !p.spotlight }));
        break;
      case 'help':
        setHelpOpen(true);
        break;
      case 'bigger':
      case 'smaller':
        setPrefs((p) => ({ size: clampSize(p.size + (action === 'bigger' ? 1 : -1)) }));
        break;
    }
  }

  /** `raw` null: a plain highlight (no words, no model call). */
  const save = async (raw: string | null, color: HighlightColor | null) => {
    if (!composer) return;
    const { target } = composer;
    const { pane } = target;
    const text = texts.get(target.anchor) ?? '';
    const range = pane ? pane.range : target.range ? toCodePointRange(text, target.range) : null;
    const passage = pane ? pane.quote : target.range ? text.slice(target.range.start, target.range.end) : null;
    const created = await add({
      documentId: doc.id,
      anchor: target.anchor,
      range,
      raw,
      color,
      passage,
      ...(pane ? { pane: { artifactId: pane.artifactId, block: pane.block, quote: pane.quote } } : {}),
    });
    if (created) {
      closeComposer();
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

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <div
      ref={readerRef}
      className={styles.reader}
      data-view={view}
      data-layout={layout}
      data-rail={showRail ? undefined : 'off'}
      data-pane={showPane ? undefined : 'off'}
      data-focus={prefs.focus ? '' : undefined}
      data-semantic={prefs.semantic ? '' : undefined}
      data-spotlight={prefs.spotlight ? '' : undefined}
      style={prefsVars(prefs, canDragMeasure(layout)) as CSSProperties}
    >
      <ReaderToolbar
        book={{ title: doc.title, href: `/documents/${doc.slug}` }}
        chapter={unit.heading ?? unit.anchor}
        prev={prev}
        next={next}
        readHref={readHref}
        view={view}
        onView={setView}
        locked={locked}
        onLock={() => setLocked((l) => !l)}
        contents={{
          open: contentsOpen,
          onToggle: () => setContentsOpen((o) => !o),
          button: contentsButton,
          popover: navigator,
        }}
        settings={{
          open: settingsOpen,
          onToggle: () => setSettingsOpen((o) => !o),
          button: settingsButton,
          panel: <ReadingSettings prefs={prefs} onChange={setPrefs} onClose={closeSettings} opener={settingsButton} />,
        }}
        layout={{
          rail: showRail,
          pane: showPane,
          focus: prefs.focus,
          onRail: () => runAction('contents'),
          onPane: () => runAction('pane'),
          onFocus: () => runAction('focus'),
          fullscreen,
        }}
        hidden={toolbarHidden}
        progress={progress}
        timeLeft={timeLeft}
        onHelp={() => setHelpOpen(true)}
      />

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
          {canDragMeasure(layout) ? (
            <MeasureHandle
              column={sourceRef}
              root={readerRef}
              anchor={isCentred(layout, showPane) ? 'centre' : 'start'}
              width={prefs.measure ?? WIDTH_REM[prefs.width] * 16}
              onChange={(measure) => setPrefs({ measure })}
            />
          ) : null}
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
            notesCount={chapterNotes.length}
            activeAnchor={active}
            activeSection={activeSection}
            locked={locked}
            paneRef={paneRef}
            onCite={onCite}
            citeHref={readHref}
            onMagnify={openDrawing}
            notes={
              <NotesPanel
                notes={wireNotes}
                unit={unit.anchor}
                units={units}
                scope={notesScope}
                onScope={setNotesScope}
                order={order}
                currentArtifacts={currentArtifacts}
                focusedId={focusedNote}
                onReveal={revealNote}
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

      {lightbox}

      <ShortcutHelp open={helpOpen} shortcuts={READER_SHORTCUTS} onClose={() => setHelpOpen(false)} />

      <div ref={composerHost}>
      {composer ? (
        <NoteComposer
          key={`${composer.target.anchor}:${composer.target.range?.start ?? 'b'}:${composer.compose}`}
          target={composer.target}
          startComposing={composer.compose}
          saving={saving}
          onHighlight={(color) => void save(null, color)}
          onSave={(raw, color) => void save(raw, color)}
          onClose={closeComposer}
        />
      ) : null}
      </div>
    </div>
  );
}

export default Reader;

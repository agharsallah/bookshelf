/**
 * The reader island: one chapter, source blocks on the left and what the shelf
 * knows about them on the right, staying put unless you turn on following.
 * Cite chips scroll to and flash their passage; hovering a passage lights up what
 * cites it. Select text (of the source, the distillation or the summary) to highlight
 * or annotate it; your notes list covers the chapter or the whole book. The URL follows the block in
 * view so any position can be shared, and your place in the chapter is saved as you read.
 * Listen (l) opens a player that reads the chapter aloud and marks the passage it is on.
 * Recall (r, or at the chapter's end) hides the text while you write what you remember,
 * and an unread chapter first asks what you expect it to argue (components/recall).
 * Continuous reading (a reading setting) adds the next chapters below as you reach the end
 * (useContinuous); the toolbar, progress and saved place follow the chapter in view, and
 * listening and recall, which work on one chapter, are off meanwhile.
 */
import { navigate } from 'astro:transitions/client';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { NoteDetail } from '../../lib/api/types/notes';
import type { RecallPublic } from '../../lib/api/types/recalls';
import type { TreeNode } from '../../lib/api/types/documents';
import type { HighlightColor } from '../../lib/contract';
import { toCodePointRange, toUtf16Range } from '../../lib/codepoints';
import { flatten, isUnder, pageMarkers } from '../../lib/documents/tree';
import { useAnchorSync } from '../../lib/hooks/useAnchorSync';
import { ChapterListen } from '../listen/ChapterListen';
import { NoteComposer, type ComposerTarget } from '../notes/NoteComposer';
import { NotesPanel, type NotesScope } from '../notes/NotesPanel';
import { useChapterCheer } from '../cheer/useChapterCheer';
import { canGrade } from '../recall/grade';
import { useRecallMode } from '../recall/useRecallMode';
import { useNotes } from '../notes/useNotes';
import { DistillPane, type Tab } from './DistillPane';
import { markSpeaking, revealBlock, sourceBlock, SOURCE_ATTR } from './dom';
import { paintPaneNotes, paneNoteAt, revealPaneNote } from './paneMarks';
import { groupMarks, marksFor, notedBlocks, type MarksByAnchor } from './marks';
import { ShortcutHelp } from '../common/ShortcutHelp';
import { Navigator, type NavSection, type NavUnit } from './Navigator';
import type { LexTerm } from './lexicon';
import type { Panes } from './panes';
import { minutesLeft, timeLeftLabel, wordCount } from './progress';
import { figureItems, figureShelf } from './figures';
import { canDragMeasure, isCentred, readerLayout } from './layout';
import { MeasureHandle } from './MeasureHandle';
import { clampSize, prefsVars, WIDTH_REM } from './prefs';
import { ReaderToolbar, type ReaderView } from './ReaderToolbar';
import { ReadingSettings } from './ReadingSettings';
import { salienceFor, type Salient } from './salience';
import { SourceBlock } from './SourceBlock';
import { useReaderPrefs } from './usePrefs';
import { actionFor, READER_SHORTCUTS, type ReaderAction } from './shortcuts';
import { useFigureLightbox } from './useFigureLightbox';
import { useFollowUrl } from './useFollowUrl';
import { useReaderEvents } from './useReaderEvents';
import { useSalienceMode } from './useSalienceMode';
import { useSavePosition } from './useSavePosition';
import { chapterOf, useContinuous } from './useContinuous';
import { activePass, usePaperMode } from './paper/usePaperMode';
import type { PaperReading } from './paper/types';
import { useAttention } from '../../lib/activity/useAttention';
import { useAutoHide, useFocusChrome, useFullscreen, useMediaQuery } from './useReaderLayout';
import styles from './Reader.module.css';
import { CollectionTrail, NextInCollection, type ReaderCollection } from './CollectionTrail';
import { readHref as collectionReadHref, inCollection } from '../collections/path';

export interface ReaderProps {
  document: { id: string; slug: string; title: string; language?: string };
  unit: TreeNode;
  units: NavUnit[];
  panes: Panes;
  /** Every note in the book: the chapter's are shown in place, the rest in the notes list. */
  notes: NoteDetail[];
  codeHtml: Record<string, string>;
  /** The book's concepts and glossary terms, for the what-matters marks. */
  lexicon?: LexTerm[];
  /** The mark-salience skill's marks for this chapter, placed on the text; null when it has not run. */
  modelMarks?: Salient[] | null;
  /** The chapter's recalls and predictions, newest first. */
  recalls?: RecallPublic[];
  /** Never opened before: an unread chapter may ask for a prediction first. */
  unread?: boolean;
  /** Chapters already finished (front matter included), so finishing another can be marked; null when unknown. */
  finished?: readonly string[] | null;
  initialAnchor: string | null;
  truncated: boolean;
  /** A paper's passes, unit roles, claim marks, notation and review questions; absent for books. */
  paper?: PaperReading | null;
  /** The collection this is read in (`?collection=`), kept in every reader link. */
  collection?: ReaderCollection | null;
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

const NO_TERMS: LexTerm[] = [];
const NO_RECALLS: RecallPublic[] = [];

export function Reader({ document: doc, unit, units, panes, notes: initialNotes, codeHtml, lexicon = NO_TERMS, modelMarks = null, recalls = NO_RECALLS, unread = false, finished = null, initialAnchor, truncated, paper: paperData = null, collection = null }: ReaderProps) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>(() => firstTab(panes));
  const [locked, setLocked] = useState(true);
  const [view, setView] = useState<ReaderView>('source');
  const [contentsOpen, setContentsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [listening, setListening] = useState(false);
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
  const nodes = useMemo(() => flat.map((f) => f.node), [flat]);
  const anchors = useMemo(() => flat.map((f) => f.node.anchor), [flat]);
  const order = useMemo(() => new Map(anchors.map((a, i) => [a, i])), [anchors]);
  const index = units.findIndex((u) => u.anchor === unit.anchor);
  const endRef = useRef<HTMLElement>(null);
  // Not in three-pass mode, which reshapes the chapter's text.
  const continuous = prefs.continuous && activePass(paperData, prefs, doc.id) === null;
  const { chapters: added } = useContinuous({
    enabled: continuous,
    slug: doc.slug,
    following: index >= 0 ? units.slice(index + 1) : [],
    stopped: truncated,
    sentinel: endRef,
  });
  const addedFlat = useMemo(() => added.flatMap((c) => c.flat), [added]);
  const texts = useMemo(() => new Map([...flat, ...addedFlat].map((f) => [f.node.anchor, f.node.text ?? ''])), [flat, addedFlat]);
  const chapterNotes = useMemo(() => wireNotes.filter((n) => isUnder(n.anchor, unit.anchor)), [wireNotes, unit.anchor]);
  // Ranges are code points on the wire and UTF-16 offsets in the DOM (lib/codepoints).
  const notes = useMemo(
    () =>
      wireNotes
        .filter((n) => n.target === 'source' && (isUnder(n.anchor, unit.anchor) || chapterOf(added, n.anchor)))
        .map((n) => (n.range ? { ...n, range: toUtf16Range(texts.get(n.anchor) ?? '', n.range) } : n)),
    [wireNotes, unit.anchor, added, texts],
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

  const active = useAnchorSync(sourceRef, SOURCE_ATTR, [flat.length, added.length]);
  // The added chapter being read, if any; `reading` is the chapter in view either way.
  const here = chapterOf(added, active);
  const reading = here?.unit ?? unit;
  const activeSection = active && !here ? (sectionOf.get(active) ?? null) : null;
  const at = !active ? 0 : here ? here.flat.findIndex((f) => f.node.anchor === active) : (order.get(active) ?? 0);
  const progress = active ? (at + 1) / Math.max(1, (here?.flat ?? flat).length) : 0;
  const figures = useMemo(() => figureItems([...nodes, ...addedFlat.map((f) => f.node)]), [nodes, addedFlat]);
  const figureList = useMemo(() => figureShelf(nodes, panes.figures), [nodes, panes.figures]);
  const words = useMemo(() => flat.map(({ node }) => wordCount(node.text ?? '')), [flat]);
  const hereWords = useMemo(() => (here ? here.flat.map(({ node }) => wordCount(node.text ?? '')) : words), [here, words]);
  const timeLeft = timeLeftLabel(minutesLeft(hereWords, at));
  const recall = useRecallMode({
    document: doc,
    unit: { anchor: unit.anchor, heading: unit.heading ?? unit.anchor },
    sectionHeadings: navSections.filter((s) => s.level === 1).map((s) => s.heading),
    recalls,
    gradable: canGrade(panes, modelMarks),
    // Three-pass mode asks its own questions (pass 1's card): no chapter prediction meanwhile.
    askPrediction: unread && prefs.predict && activePass(paperData, prefs, doc.id) === null,
    nodes,
    onShowGaps: () => setPrefs({ salience: true }),
  });
  const salience = useSalienceMode({
    sourceRef,
    nodes,
    panes,
    lexicon,
    modelMarks: recall.gaps ?? modelMarks,
    exclusive: recall.gaps !== null,
    enabled: prefs.salience,
    storageKey: `${doc.slug}:${unit.anchor}${recall.gaps ? ':gaps' : ''}`,
    order,
    activeAnchor: active,
    onKeep: async (s) => {
      const text = texts.get(s.anchor) ?? '';
      const range = { start: s.start, end: s.end };
      const created = await add({ documentId: doc.id, anchor: s.anchor, range: toCodePointRange(text, range), raw: null, color: 'amber', passage: text.slice(s.start, s.end) });
      return Boolean(created);
    },
  });

  // The block being read carries `data-active`, for the spotlight. Set on the DOM so no block re-renders.
  useEffect(() => {
    const el = active && sourceRef.current ? sourceBlock(sourceRef.current, active) : null;
    el?.setAttribute('data-active', '');
    return () => el?.removeAttribute('data-active');
  }, [active]);

  useEffect(() => (paneRef.current ? paintPaneNotes(paneRef.current, paneNotes) : undefined), [paneNotes, tab, view]);

  const trail = collection?.slug ?? null;
  const readHref = useCallback((anchor: string) => (trail ? collectionReadHref(doc.slug, trail, anchor) : `/documents/${doc.slug}/read/${anchor}`), [doc.slug, trail]);
  const readingIndex = units.findIndex((u) => u.anchor === reading.anchor);
  const prev = units[readingIndex - 1] ?? null;
  const next = units[readingIndex + 1] ?? null;
  // After the last chapter on the page: what the end of the text links to.
  const afterShown = units[units.findIndex((u) => u.anchor === (added.at(-1)?.unit ?? unit).anchor) + 1] ?? null;
  // Papers only: three-pass mode and claim marks (paper/usePaperMode); inert for a book.
  const paper = usePaperMode({ paper: paperData, document: doc, unit, flat, prefs, setPrefs, sourceRef, readHref, onCite: (a) => onCite(a), initialAnchor });

  useFollowUrl(active, readHref, initialAnchor);
  const atEnd = useSavePosition(doc.slug, reading.anchor, active, progress);
  useChapterCheer({ atEnd, unit: reading, units, finishedBefore: finished, book: doc.title });
  // Reading time goes to the block being read; with the text hidden, it is recall time.
  useAttention(recall.hidden ? { surface: 'recall', document: doc.slug, unit: unit.anchor } : { surface: 'read', document: doc.slug, unit: reading.anchor, anchor: active ?? undefined });

  // Land on the anchor from the URL.
  useEffect(() => {
    if (initialAnchor && initialAnchor !== unit.anchor && sourceRef.current) revealBlock(sourceRef.current, initialAnchor);
  }, [initialAnchor, unit.anchor]);

  const onCite = useCallback(
    (anchor: string) => {
      setView('source');
      if (paper.reveal(anchor)) return;
      if (!sourceRef.current || !revealBlock(sourceRef.current, anchor)) void navigate(readHref(anchor));
    },
    [readHref, paper.reveal],
  );
  const { openFigure, openDrawing, open: lightboxOpen, lightbox } = useFigureLightbox(figures, onCite);

  const openNote = useCallback((id: string) => {
    setTab('notes');
    setView('distil');
    // A note in an added chapter is only in the whole book's list.
    if (!chapterNotes.some((n) => n.id === id)) setNotesScope('book');
    setFocusedNote(id);
    requestAnimationFrame(() => paneRef.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(id)}"]`)?.focus());
  }, [chapterNotes]);

  /** Show what a note marks: its passage in the text, its block on the pane, or its chapter. */
  const revealNote = (note: NoteDetail) => {
    if (note.target === 'source') return onCite(note.anchor);
    if (!isUnder(note.anchor, unit.anchor)) return void navigate(readHref(note.anchor));
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
    anchors: paper.anchors(addedFlat.length ? [...anchors, ...addedFlat.map((f) => f.node.anchor)] : anchors),
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
      const action = helpOpen || lightboxOpen || recall.hidden ? null : actionFor(event);
      if (action) runAction(action);
      return action !== null;
    },
    onNoteClick: openNote,
    onSalientClick: salience.openAt,
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
      case 'salience':
        setPrefs((p) => ({ salience: !p.salience }));
        break;
      case 'nextIdea':
        if (prefs.salience) salience.next();
        break;
      case 'spotlight':
        setPrefs((p) => ({ spotlight: !p.spotlight }));
        break;
      case 'listen':
        if (!continuous) setListening((l) => !l);
        break;
      case 'recall':
        if (!continuous) recall.open();
        break;
      case 'passes':
        paper.toggle();
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
      readHref={readHref}
      units={units}
      current={reading.anchor}
      sections={here ? [] : navSections}
      activeSection={activeSection}
      progress={progress}
      onSection={(anchor) => {
        setContentsOpen(false);
        if (sourceRef.current) revealBlock(sourceRef.current, anchor);
      }}
    />
  );

  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const onSpeaking = useCallback((anchor: string | null, follow: boolean) => {
    if (sourceRef.current) markSpeaking(sourceRef.current, anchor, follow);
  }, []);

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
      data-salience={prefs.salience ? '' : undefined}
      data-spotlight={prefs.spotlight ? '' : undefined}
      data-recall={recall.hidden ? '' : undefined}
      data-passes={paper.pass ?? undefined}
      style={prefsVars(prefs, canDragMeasure(layout)) as CSSProperties}
    >
      <ReaderToolbar
        book={{ title: doc.title, href: inCollection(`/documents/${doc.slug}`, trail) }}
        chapter={reading.heading ?? reading.anchor}
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
        listen={continuous ? null : { open: listening, onToggle: () => runAction('listen') }}
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
        extra={paper.toolbar}
      />

      <div className={styles.columns} inert={recall.hidden}>
        <aside className={styles.navColumn}>{navigator}</aside>

        <article className={styles.source} ref={sourceRef} aria-label="Text">
          {collection ? <CollectionTrail collection={collection} documentId={doc.id} /> : null}
          {truncated ? <p className={styles.notice}>This chapter is very long; only its first 2,000 blocks are shown.</p> : null}
          {flat.length === 0 ? <p className={styles.notice}>This chapter has no text blocks.</p> : null}
          {paper.render(({ node }, i) => (
            <SourceBlock
              key={node.anchor}
              node={node}
              marks={marksFor(marks, node.anchor)}
              salient={salienceFor(salience.byAnchor, node.anchor)}
              page={pages[i] ?? null}
              codeHtml={codeHtml[node.anchor]}
              hasBlockNote={blockNotes.has(node.anchor)}
              level={node.depth - unit.depth}
              margin={paper.margin(node.anchor)}
            />
          ))}
          {added.map((c) => {
            const marked = pageMarkers(c.flat);
            return (
              <Fragment key={c.unit.anchor}>
                <h2 className={styles.continued}>{c.unit.heading ?? c.unit.anchor}</h2>
                {c.flat.map(({ node }, i) => (
                  <SourceBlock
                    key={node.anchor}
                    node={node}
                    marks={marksFor(marks, node.anchor)}
                    page={marked[i] ?? null}
                    hasBlockNote={blockNotes.has(node.anchor)}
                    level={node.depth - c.unit.depth}
                  />
                ))}
                {c.truncated ? <p className={styles.notice}>This chapter is very long; only its first 2,000 blocks are shown.</p> : null}
              </Fragment>
            );
          })}
          {canDragMeasure(layout) ? (
            <MeasureHandle
              column={sourceRef}
              root={readerRef}
              anchor={isCentred(layout, showPane) ? 'centre' : 'start'}
              width={prefs.measure ?? WIDTH_REM[prefs.width] * 16}
              onChange={(measure) => setPrefs({ measure })}
            />
          ) : null}
          {salience.meter}
          <footer className={styles.end} ref={endRef}>
            {paper.footer}
            {continuous ? null : recall.footer}
            {afterShown ? (
              <a href={readHref(afterShown.anchor)}>Next: {afterShown.heading}</a>
            ) : collection ? (
              <NextInCollection collection={collection} documentId={doc.id} />
            ) : (
              <a href={inCollection(`/documents/${doc.slug}`, trail)}>Back to the document</a>
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
            figures={figureList}
            onOpenFigure={openFigure}
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
      {salience.card}
      {recall.overlay}
      {paper.overlay}
      {listening && !continuous ? (
        <ChapterListen
          documentId={doc.id}
          bookTitle={doc.title}
          anchor={unit.anchor}
          chapter={unit.heading ?? unit.anchor}
          language={doc.language}
          activeAnchor={active}
          order={order}
          onSpeaking={onSpeaking}
          onClose={() => setListening(false)}
        />
      ) : null}

      <ShortcutHelp open={helpOpen} shortcuts={paper.shortcuts(READER_SHORTCUTS)} onClose={() => setHelpOpen(false)} />

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

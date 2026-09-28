/**
 * Everything the reader does differently for a paper, in one hook (docs/PAPERS.md §6, §5):
 *
 * - **Three-pass mode** (`p`, or the toolbar's Passes): pass 1 skims, pass 2 reads the body,
 *   pass 3 everything (./passes.ts). The pass on is remembered per paper in the reading
 *   preferences (`prefs.paperPasses`). Sections a pass sets aside fold to their heading;
 *   a cite into one unfolds it. The unit closing the pass ends on a card (./flow.ts):
 *   pass 1's answers are saved as a prediction, and each pass is marked done
 *   (`PUT /papers/{ref}/passes/{n}`). From pass 2 the notation table is a side panel.
 * - **Claim marks**, in any mode: blocks that are evidence for a claim carry a margin mark
 *   with the shelf's verdicts; it opens the claims and their cross-paper relations.
 *
 * With `paper` null (books, articles) it is inert: every block shows, nothing is added.
 */
import { navigate } from 'astro:transitions/client';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { browserApi, type ApiClient } from '../../../lib/api/client';
import type { TreeNode } from '../../../lib/api/types/documents';
import type { PassNumber } from '../../../lib/api/types/papers';
import type { FlatNode } from '../../../lib/documents/tree';
import { completePass } from '../../../lib/papers/api';
import type { Shortcut } from '../../common/ShortcutHelp';
import { problemOf } from '../../common/Problem';
import { writeRecall } from '../../recall/api';
import { revealBlock } from '../dom';
import type { ReaderPrefs } from '../prefs';
import type { PrefsUpdate } from '../usePrefs';
import { ClaimMarkButton } from './ClaimMarkButton';
import { ClaimPopover } from './ClaimPopover';
import { claimMarksByBlock } from './claimMarks';
import { FoldedSection } from './FoldedSection';
import { flowReducer, initialFlow, predictionText, type FlowEvent, type FlowState } from './flow';
import { NotationPanel } from './NotationPanel';
import { PassControl } from './PassControl';
import { PassEndCard } from './PassEndCard';
import { closingUnit, foldOf, nextPass, planUnit, predictionUnit, visibleAnchors, type PassItem } from './passes';
import type { PaperReading } from './types';

export const PAPER_SHORTCUTS: readonly Shortcut[] = [{ keys: ['p'], label: 'Three-pass reading on or off (papers)' }];

type Api = Pick<ApiClient, 'get' | 'post' | 'put' | 'patch' | 'delete'>;

export interface PaperModeOptions {
  paper: PaperReading | null;
  document: { id: string; slug: string };
  unit: TreeNode;
  flat: readonly FlatNode[];
  prefs: ReaderPrefs;
  setPrefs: (update: PrefsUpdate) => void;
  sourceRef: RefObject<HTMLElement | null>;
  readHref: (anchor: string) => string;
  /** The reader's cite handler (late-bound: called only on a click). */
  onCite: (anchor: string) => void;
  initialAnchor: string | null;
  api?: Api;
}

export interface PaperMode {
  /** The pass on, or null (mode off, or not a paper). */
  pass: PassNumber | null;
  /** Draw the unit: `block(entry, index)` draws `flat[index]`; folds are drawn here. */
  render: (block: (entry: FlatNode, index: number) => ReactNode) => ReactNode;
  /** The anchors on screen, for j/k. */
  anchors: (all: readonly string[]) => readonly string[];
  /** A claim mark for a block's margin, if it has one. */
  margin: (anchor: string) => ReactNode;
  /** Unfold the section hiding `anchor` and reveal it; false when nothing hides it. */
  reveal: (anchor: string) => boolean;
  toggle: () => void;
  toolbar: ReactNode;
  footer: ReactNode;
  overlay: ReactNode;
  shortcuts: (base: readonly Shortcut[]) => readonly Shortcut[];
}

const NO_OPENED: ReadonlySet<string> = new Set();

/** The pass on for this document, or null (mode off, or not a paper). */
export function activePass(paper: PaperReading | null, prefs: ReaderPrefs, documentId: string): PassNumber | null {
  return paper ? (prefs.paperPasses[documentId] ?? null) : null;
}

export function usePaperMode(options: PaperModeOptions): PaperMode {
  const { paper, document: doc, unit, flat, prefs, setPrefs, sourceRef, readHref, initialAnchor, api = browserApi } = options;
  const onCiteRef = useRef(options.onCite);
  onCiteRef.current = options.onCite;
  const cite = useCallback((anchor: string) => onCiteRef.current(anchor), []);

  const pass = activePass(paper, prefs, doc.id);
  const [done, setDone] = useState<ReadonlySet<number>>(() => new Set(paper?.passes.map((p) => p.pass) ?? []));

  // Folds opened by hand (or by a cite, or the URL's anchor) stay open for this page.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => {
    if (!paper || !initialAnchor || pass === null) return NO_OPENED;
    const fold = foldOf(planUnit(pass, unit, flat), initialAnchor);
    return fold ? new Set([fold]) : NO_OPENED;
  });
  const items: PassItem[] = useMemo(() => planUnit(pass, unit, flat, opened), [pass, unit, flat, opened]);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (pending && sourceRef.current) revealBlock(sourceRef.current, pending);
    setPending(null);
  }, [pending, sourceRef]);

  const unfold = useCallback((anchor: string) => setOpened((o) => new Set([...o, anchor])), []);
  const reveal = useCallback(
    (anchor: string) => {
      const fold = foldOf(itemsRef.current, anchor);
      if (!fold || fold === anchor) return false;
      unfold(fold);
      setPending(anchor);
      return true;
    },
    [unfold],
  );

  const setPass = useCallback(
    (next: PassNumber | null) =>
      setPrefs((p) => {
        // Re-added last, so the most recently used papers survive the cap (prefs.MAX_PAPER_PASSES).
        const others = Object.entries(p.paperPasses).filter(([id]) => id !== doc.id);
        return { paperPasses: Object.fromEntries(next === null ? others : [...others, [doc.id, next]]) };
      }),
    [setPrefs, doc.id],
  );
  const toggle = useCallback(() => {
    if (!paper) return;
    setPass(pass === null ? nextPass([...done]) : null);
  }, [paper, pass, done, setPass]);

  // ── Finishing a pass ──
  const [flow, setFlow] = useState<{ pass: PassNumber | null; state: FlowState }>({ pass, state: initialFlow(pass !== null && done.has(pass)) });
  const flowState = pass !== null && flow.pass === pass ? flow.state : initialFlow(pass !== null && done.has(pass));
  const dispatch = useCallback(
    (event: FlowEvent) => {
      if (pass === null) return;
      setFlow((prev) => ({ pass, state: flowReducer(pass, prev.pass === pass ? prev.state : initialFlow(done.has(pass)), event) }));
    },
    [pass, done],
  );
  const predicted = useRef(false);
  const saving = flowState.step === 'saving' ? flowState : null;
  useEffect(() => {
    if (!saving || pass === null || !paper) return;
    let live = true;
    const target = predictionUnit(paper.units);
    const save = async () => {
      if (pass === 1 && saving.answers && !predicted.current && target) {
        await writeRecall(api, doc.slug, target, 'prediction', predictionText(saving.answers));
        predicted.current = true;
      }
      await completePass(api, doc.slug, pass);
    };
    save()
      .then(() => {
        setDone((d) => new Set([...d, pass]));
        if (live) dispatch({ type: 'saved' });
      })
      .catch((error: unknown) => live && dispatch({ type: 'failed', message: problemOf(error).message }));
    return () => {
      live = false;
    };
    // Runs once per entry into `saving` (the state object changes only then).
  }, [saving, pass, paper, api, doc.slug, dispatch]);

  // ── Notation panel ──
  const [notationOpen, setNotationOpen] = useState(false);
  const notation = paper?.notation && pass !== null && pass >= 2 ? paper.notation : null;

  // ── Claim marks ──
  const blocks = useMemo(() => claimMarksByBlock(paper?.marks ?? [], new Set(flat.map((f) => f.node.anchor))), [paper, flat]);
  const [popover, setPopover] = useState<{ anchor: string; opener: HTMLElement } | null>(null);
  const openMark = useCallback((anchor: string, opener: HTMLElement) => setPopover((p) => (p?.anchor === anchor ? null : { anchor, opener })), []);
  const closeMark = useCallback(() => setPopover(null), []);
  const marginNodes = useMemo(() => {
    const out = new Map<string, ReactNode>();
    for (const [anchor, block] of blocks) out.set(anchor, <ClaimMarkButton block={block} open={popover?.anchor === anchor} onOpen={openMark} />);
    return out;
  }, [blocks, popover?.anchor, openMark]);

  const render: PaperMode['render'] = (block) =>
    items.map((item) => {
      if (item.type === 'fold') return <FoldedSection key={item.fold.anchor} fold={item.fold} onUnfold={unfold} />;
      const entry = flat[item.index];
      return entry ? block(entry, item.index) : null;
    });
  if (!paper) return { ...INERT, render };

  const closing = pass !== null && unit.anchor === closingUnit(pass, paper.units);
  // A new pass starts at the abstract (front matter comes before it).
  const first = predictionUnit(paper.units);
  const popBlock = popover ? blocks.get(popover.anchor) : undefined;

  return {
    pass,
    render,
    anchors: (all) => (pass === null ? all : visibleAnchors(items, flat)),
    margin: (anchor) => marginNodes.get(anchor),
    reveal,
    toggle,
    toolbar: (
      <PassControl
        pass={pass}
        done={done}
        onToggle={toggle}
        onPass={setPass}
        notation={notation ? { open: notationOpen, onToggle: () => setNotationOpen((o) => !o) } : null}
      />
    ),
    footer:
      closing && pass !== null ? (
        <PassEndCard
          pass={pass}
          state={flowState}
          dispatch={dispatch}
          questions={paper.questions}
          onCite={cite}
          citeHref={readHref}
          onNext={
            pass < 3
              ? () => {
                  setPass((pass + 1) as PassNumber);
                  if (first && first !== unit.anchor) void navigate(readHref(first));
                  else window.scrollTo({ top: 0 });
                }
              : null
          }
        />
      ) : null,
    overlay: (
      <>
        {notation && notationOpen ? <NotationPanel slug={doc.slug} notation={notation} onCite={cite} citeHref={readHref} onClose={() => setNotationOpen(false)} /> : null}
        {popover && popBlock ? <ClaimPopover block={popBlock} document={doc} opener={popover.opener} onCite={cite} onClose={closeMark} api={api} /> : null}
      </>
    ),
    shortcuts: (base) => [...base.slice(0, -2), ...PAPER_SHORTCUTS, ...base.slice(-2)],
  };
}

/** A book or an article: every block drawn as before, nothing added. */
const INERT: Omit<PaperMode, 'render'> = {
  pass: null,
  anchors: (all) => all,
  margin: () => undefined,
  reveal: () => false,
  toggle: () => undefined,
  toolbar: null,
  footer: null,
  overlay: null,
  shortcuts: (base) => base,
};

/**
 * The map (§11, §12): the whole shelf as a live force layout — books, their chapters, the
 * concepts they discuss — with two ways of looking at it.
 *
 * - **Map**: everything. Hover lights a node and its neighbours; search highlights names.
 * - **Lens**: filter and highlight one aspect (connection types, kinds, books, ideas
 *   that cross books); dim or hide the rest; group the layout by book.
 *
 * Click a mark or a line to see it in the margin, with the way back to its content;
 * double-click a mark to open it (a chapter in the reader, a concept on its page, a book
 * on its page). Picking something from the margin or the list glides the map to it.
 * The view lives in the URL, so a lens can be bookmarked.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Problem, problemOf, type ProblemInfo } from '../common/Problem';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { Atlas } from '../../lib/api/types/graph';
import { conceptHref, documentHref, readerHref } from '../search/links';
import type { Selection } from '../graph/controller';
import { GraphCanvas } from '../graph/GraphCanvas';
import { KindMark, RelationMark } from '../graph/Legend';
import { usePrefersReducedMotion } from '../graph/palette';
import { parseRef } from '../graph/refs';
import { LINK_KINDS, LINK_STYLES } from '../graph/styles';
import { AtlasDetail } from './AtlasDetail';
import { AtlasList } from './AtlasList';
import { atlasKit } from './layout';
import { lensToParams, MODES, type LensState } from './lens';
import { LensPanel } from './LensPanel';
import { buildAtlasModel, indexAtlas } from './model';
import graph from '../graph/Graph.module.css';
import styles from './Atlas.module.css';

export interface AtlasExplorerProps {
  initial: Atlas;
  lens: LensState;
  api?: ApiClient;
}

/** Where a mark leads when you open it. */
export function openHref(node: Atlas['nodes'][number]): string | null {
  if (node.kind === 'concept') {
    const parsed = parseRef(node.id);
    return parsed ? conceptHref(parsed.id) : null;
  }
  if (!node.document) return null;
  return node.kind === 'chapter' ? readerHref(node.document.slug, node.anchor) : documentHref(node.document.slug);
}

function isNodeRef(id: string): boolean {
  return /^(concept|document|node):/.test(id);
}

export function AtlasExplorer({ initial, lens: initialLens, api = browserApi }: AtlasExplorerProps) {
  const [atlas, setAtlas] = useState(initial);
  const [lens, setLens] = useState(initialLens);
  const [edgeSelected, setEdgeSelected] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [glide, setGlide] = useState<{ id: string } | null>(null);
  const [problem, setProblem] = useState<ProblemInfo | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  const index = useMemo(() => indexAtlas(atlas), [atlas]);
  const { mode, links, kinds, books, crossBook, others, query } = lens;
  // Selection is not a filter: picking a node must not rebuild (and so reflow) the map.
  const filters = useMemo(() => ({ mode, links, kinds, books, crossBook, others, query }), [mode, links, kinds, books, crossBook, others, query]);
  const view = useMemo(() => buildAtlasModel(index, filters), [index, filters]);
  const kit = atlasKit(mode === 'lens' ? lens.group : 'free');

  useEffect(() => {
    const qs = lensToParams(lens).toString();
    history.replaceState(null, '', qs ? `/map?${qs}` : '/map');
  }, [lens]);

  const reload = useCallback(() => {
    api
      .get<Atlas>('graph/atlas')
      .then((next) => {
        setAtlas(next);
        setProblem(null);
      })
      .catch((error: unknown) => setProblem(problemOf(error)));
  }, [api]);

  const change = (next: LensState) => setLens(next);
  const pick = (id: string) => {
    setEdgeSelected(null);
    setLens((l) => ({ ...l, selected: id }));
    setGlide({ id });
  };
  const onCanvasSelect = (s: Selection) => {
    if (s?.kind === 'edge') {
      setEdgeSelected(s.id);
      setLens((l) => ({ ...l, selected: null }));
    } else {
      setEdgeSelected(null);
      setLens((l) => ({ ...l, selected: s?.id ?? null }));
    }
  };
  const open = (id: string) => {
    const node = index.byId.get(id);
    const href = node ? openHref(node) : null;
    if (href) window.location.assign(href);
  };

  const selectedNode = lens.selected && isNodeRef(lens.selected) ? (index.byId.get(lens.selected) ?? null) : null;
  const selectedEdge = edgeSelected ? (view.model.edges.find((e) => e.id === edgeSelected) ?? null) : null;
  const selection: Selection = selectedEdge ? { kind: 'edge', id: selectedEdge.id } : selectedNode ? { kind: 'node', id: selectedNode.id } : null;
  const present = LINK_KINDS.filter((l) => atlas.edges.some((e) => e.relation === l));
  const empty = atlas.nodes.length === 0;

  return (
    <div className={graph.explorer}>
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <h1>Map</h1>
          <p className={styles.lede}>
            Your shelf at a glance: each book, the chapters that take part in the graph, and the ideas they share. Select anything to see how it
            connects and read it in context.
          </p>
        </div>
        <div className={styles.tools}>
          <fieldset className={graph.segmented}>
            <legend>View</legend>
            {MODES.map((m) => (
              <label key={m}>
                <input type="radio" name="mode" checked={mode === m} onChange={() => change({ ...lens, mode: m })} />
                <span>{m === 'map' ? 'Map' : 'Lens'}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.search}>
            <span className={styles.srOnly}>Highlight names</span>
            <input type="search" placeholder="Highlight a name…" value={query} onChange={(e) => change({ ...lens, query: e.target.value })} />
          </label>
        </div>
        <p className={graph.count} aria-live="polite">
          {view.shown.nodes === view.total.nodes && view.shown.edges === view.total.edges
            ? `${view.total.nodes} marks, ${view.total.edges} connections`
            : `${view.shown.nodes} of ${view.total.nodes} marks and ${view.shown.edges} of ${view.total.edges} connections in view`}
          {atlas.truncated ? ', the best connected only' : ''}
        </p>
      </header>

      {problem ? <Problem inline title="The map could not be refreshed; showing the previous one." problem={problem} /> : null}

      {empty ? (
        <div className={graph.lonely}>
          <p>The map is empty. Once a book's concepts are linked, its chapters and ideas appear here.</p>
        </div>
      ) : (
        <div className={mode === 'lens' ? styles.bodyLens : styles.body}>
          {mode === 'lens' ? <LensPanel index={index} lens={lens} onChange={change} /> : null}
          <div className={graph.stage}>
            {view.model.nodes.length === 0 ? (
              <div className={graph.lonely}>
                <p>Nothing on the shelf fits this lens.</p>
              </div>
            ) : (
              <GraphCanvas
                model={view.model}
                selected={selection}
                highlight={highlight}
                reducedMotion={reducedMotion}
                onSelect={onCanvasSelect}
                onFocusRequest={open}
                kit={kit}
                lens={view.lens}
                glide={glide}
                label={`Map of the shelf: ${view.model.nodes.length} marks and ${view.model.edges.length} connections. The list below holds the same.`}
              />
            )}
            <aside className={graph.panel} aria-label="Selection" aria-live="polite">
              {selectedNode || selectedEdge ? (
                <AtlasDetail api={api} index={index} node={selectedNode} edge={selectedEdge} onSelect={pick} onChanged={reload} />
              ) : (
                <div className={graph.panelBody}>
                  <p className={graph.hint}>
                    Select a mark or a line to see its connections. Double-click a mark to open it. Scroll to zoom, drag to move.
                  </p>
                  {mode === 'map' ? (
                    <button type="button" className={graph.action} onClick={() => change({ ...lens, mode: 'lens' })}>
                      Focus with the lens
                    </button>
                  ) : null}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}

      <div className={graph.legend} aria-label="Key">
        <ul>
          <li>
            <KindMark kind="document" />
            Books
          </li>
          <li>
            <KindMark kind="node" />
            Chapters
          </li>
          <li>
            <KindMark kind="concept" />
            Concepts (bigger is better connected)
          </li>
        </ul>
        <ul>
          {present.map((l) => (
            <li key={l}>
              <RelationMark relation={l} />
              {LINK_STYLES[l].label}
            </li>
          ))}
        </ul>
      </div>

      <details className={graph.listBox}>
        <summary>The map as a list</summary>
        <AtlasList model={view.model} lens={view.lens} selected={selectedNode?.id ?? null} onSelect={pick} onHighlight={setHighlight} />
      </details>
    </div>
  );
}

export default AtlasExplorer;

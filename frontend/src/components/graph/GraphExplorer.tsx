/**
 * The graph (§11, §12): one focal node's neighbourhood on a canvas, a detail panel for
 * whatever is selected, and the same neighbourhood as a keyboard-navigable list.
 *
 * - Click a node or a line to see it; double-click a node (or "Focus here") to centre
 *   on it: the next neighbourhood is fetched and the picture reflows toward it.
 * - Depth 1/2 and "include proposed" re-fetch; "show more" widens the visible budget
 *   (never past 150 nodes). Focus and view live in the URL; back/forward work.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Problem } from '../document/Problem';
import { browserApi, type ApiClient } from '../../lib/api/client';
import type { GraphRef, Neighborhood } from '../../lib/api/types/graph';
import { useNeighborhood } from '../../lib/hooks/useNeighborhood';
import type { Selection } from './controller';
import { EdgeEvidence } from './EdgeEvidence';
import { GraphCanvas } from './GraphCanvas';
import { Legend } from './Legend';
import { buildModel, INITIAL_BUDGET, nextBudget } from './model';
import { NeighborhoodList } from './NeighborhoodList';
import { NodeDetail } from './NodeDetail';
import { usePrefersReducedMotion } from './palette';
import { graphHref, refFromPath, viewFromParams, type GraphView } from './refs';
import { KIND_STYLES } from './styles';
import styles from './Graph.module.css';

export interface GraphExplorerProps {
  focus: GraphRef;
  view: GraphView;
  initial: Neighborhood | null;
  api?: ApiClient;
}

export function GraphExplorer({ focus: initialFocus, view: initialView, initial, api = browserApi }: GraphExplorerProps) {
  const [focus, setFocus] = useState(initialFocus);
  const [view, setView] = useState(initialView);
  const [budget, setBudget] = useState(INITIAL_BUDGET);
  const [selected, setSelected] = useState<Selection>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const { hood, answered, loading, problem, reload } = useNeighborhood(api, focus, view, initial);

  const model = useMemo(() => (hood ? buildModel(hood, budget) : null), [hood, budget]);
  const focusNode = model?.nodes.find((n) => n.id === model.focus) ?? null;

  const go = useCallback((ref: GraphRef, next: GraphView, push = true) => {
    setFocus(ref);
    setView(next);
    setSelected(null);
    setBudget(INITIAL_BUDGET);
    if (push) history.pushState(null, '', graphHref(ref, next));
  }, []);

  useEffect(() => {
    const onPop = () => {
      const ref = refFromPath(location.pathname.replace(/^\/graph\/?/, ''));
      if (ref) go(ref, viewFromParams(new URLSearchParams(location.search)), false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [go]);

  // The server may resolve a merged concept to its survivor: keep the URL honest.
  useEffect(() => {
    if (hood && answered === focus && hood.focus !== focus) history.replaceState(null, '', graphHref(hood.focus, view));
  }, [hood, answered, focus, view]);

  // Client-side re-focus keeps the tab title in step ("<focus> — <app>").
  const focusLabel = focusNode?.label;
  useEffect(() => {
    if (focusLabel) document.title = document.title.replace(/^.*?(?= — )|^[^—]*$/, focusLabel);
  }, [focusLabel]);

  const changeView =(patch: Partial<GraphView>) => go(model?.focus ?? focus, { ...view, ...patch });
  const refocus = (id: string) => go(id, view);

  if (!model) {
    return problem ? (
      <Problem title="This neighbourhood could not be loaded." problem={problem} />
    ) : (
      <p className={styles.loading}>Gathering the neighbourhood…</p>
    );
  }

  const selectedNode = selected?.kind === 'node' ? model.nodes.find((n) => n.id === selected.id) : undefined;
  const selectedEdge = selected?.kind === 'edge' ? model.edges.find((e) => e.id === selected.id) : undefined;
  const available = model.nodes.length + model.hidden;
  const title = focusNode?.label ?? 'Neighbourhood';

  return (
    <div className={styles.explorer} aria-busy={loading}>
      <header className={styles.toolbar}>
        <div className={styles.focusHead}>
          <p className={styles.focusKind}>{focusNode ? KIND_STYLES[focusNode.kind].label : 'Focus'}</p>
          <h1 className={styles.focusTitle}>{title}</h1>
        </div>
        <div className={styles.controls}>
          <fieldset className={styles.segmented}>
            <legend>Depth</legend>
            {([1, 2] as const).map((d) => (
              <label key={d}>
                <input type="radio" name="depth" checked={view.depth === d} onChange={() => changeView({ depth: d })} />
                <span>{d === 1 ? 'One step' : 'Two steps'}</span>
              </label>
            ))}
          </fieldset>
          <label className={styles.toggle}>
            <input type="checkbox" checked={view.proposed} onChange={(e) => changeView({ proposed: e.target.checked })} />
            Include proposed links
          </label>
        </div>
        <p className={styles.count} aria-live="polite">
          {loading ? 'Loading… ' : ''}
          {model.nodes.length} of {available} shown{model.truncated ? ', trimmed to the 150 strongest' : ''}
          {model.hidden > 0 ? (
            <button type="button" className={styles.more} onClick={() => setBudget((b) => nextBudget(b, available))}>
              Show {Math.min(model.hidden, nextBudget(budget, available) - budget)} more
            </button>
          ) : null}
        </p>
      </header>

      {problem ? <Problem inline title="The last change could not be loaded; showing the previous view." problem={problem} /> : null}

      <div className={styles.stage}>
        {model.nodes.length <= 1 ? (
          <div className={styles.lonely}>
            <p>Nothing is linked to {title} yet{view.proposed ? '' : ' (proposed links are hidden)'}.</p>
            {view.proposed ? null : (
              <button type="button" className={styles.more} onClick={() => changeView({ proposed: true })}>
                Include proposed links
              </button>
            )}
          </div>
        ) : (
          <GraphCanvas
            model={model}
            selected={selected}
            highlight={highlight}
            reducedMotion={reducedMotion}
            onSelect={setSelected}
            onFocusRequest={refocus}
            label={`Neighbourhood of ${title}: ${model.nodes.length} nodes and ${model.edges.length} links. The list below holds the same.`}
          />
        )}
        <aside className={styles.panel} aria-label="Selection" aria-live="polite">
          {selectedEdge ? (
            <EdgeEvidence api={api} edge={selectedEdge} onChanged={reload} />
          ) : selectedNode ? (
            <NodeDetail node={selectedNode} isFocus={selectedNode.id === model.focus} onFocus={refocus} />
          ) : focusNode ? (
            <>
              <NodeDetail node={focusNode} isFocus onFocus={refocus} />
              <p className={styles.hint}>Select a node or a line to see its evidence. Double-click a node to centre on it.</p>
            </>
          ) : null}
        </aside>
      </div>

      <Legend />

      <details className={styles.listBox} open>
        <summary>The neighbourhood as a list</summary>
        <NeighborhoodList model={model} selected={selected} onSelect={setSelected} onHighlight={setHighlight} />
      </details>
    </div>
  );
}

export default GraphExplorer;

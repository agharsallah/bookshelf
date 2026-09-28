/**
 * The neighbourhood as a list: the accessible, keyboard-first view of exactly what the
 * canvas shows, kept in step with it. Nodes are grouped by ring; each edge is listed
 * once, under its endpoint farther from the focus. ↑/↓ move, Enter selects, and
 * focusing an entry lights it on the canvas.
 */
import { useMemo, useRef, type KeyboardEvent } from 'react';
import type { Selection } from './controller';
import type { GraphModel, ModelEdge, ModelNode } from './model';
import { CONCEPT_KIND_STYLES, KIND_STYLES, LINK_STYLES } from './styles';
import { KindMark } from './Legend';
import styles from './Graph.module.css';

const RINGS = ['The focus', 'One step away', 'Two steps away'];

export interface NeighborhoodListProps {
  model: GraphModel;
  selected: Selection;
  onSelect: (selection: Selection) => void;
  onHighlight: (id: string | null) => void;
}

function edgeLine(edge: ModelEdge, self: string, byId: Map<string, ModelNode>): string {
  const style = LINK_STYLES[edge.relation];
  const otherId = edge.source === self ? edge.target : edge.source;
  const other = byId.get(otherId)?.label ?? otherId;
  const evidence = edge.data.evidence_count === 1 ? '1 passage' : `${edge.data.evidence_count} passages`;
  const status = edge.status === 'proposed' ? ', proposed' : '';
  return edge.source === self ? `${style.verb} ${other} (${evidence}${status})` : `${other} ${style.verb} this (${evidence}${status})`;
}

export function NeighborhoodList({ model, selected, onSelect, onHighlight }: NeighborhoodListProps) {
  const root = useRef<HTMLDivElement>(null);
  const byId = useMemo(() => new Map(model.nodes.map((n) => [n.id, n])), [model]);
  const edgesUnder = useMemo(() => {
    const out = new Map<string, ModelEdge[]>();
    for (const e of model.edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      const owner = b.depth >= a.depth ? b.id : a.id;
      out.set(owner, [...(out.get(owner) ?? []), e]);
    }
    return out;
  }, [model, byId]);
  const rings = [0, 1, 2].map((d) => model.nodes.filter((n) => n.depth === d)).filter((r) => r.length > 0);

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('button[data-item]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[Math.max(0, Math.min(items.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  };

  const isSel = (kind: 'node' | 'edge', id: string) => selected?.kind === kind && selected.id === id;

  return (
    <div ref={root} className={styles.list} onKeyDown={onKey} onBlur={() => onHighlight(null)}>
      {rings.map((ring) => (
        <section key={ring[0]?.depth} aria-label={RINGS[ring[0]?.depth ?? 0]}>
          <h3 className={styles.ringHead}>{RINGS[ring[0]?.depth ?? 0]}</h3>
          <ul className={styles.ringList}>
            {ring.map((node) => (
              <li key={node.id}>
                <button
                  type="button"
                  data-item=""
                  className={styles.listNode}
                  aria-pressed={isSel('node', node.id)}
                  onClick={() => onSelect({ kind: 'node', id: node.id })}
                  onFocus={() => onHighlight(node.id)}
                >
                  <KindMark kind={node.kind} conceptKind={node.conceptKind} />
                  <span className={styles.listLabel}>{node.label}</span>
                  <span className="visually-hidden">, {node.conceptKind ? CONCEPT_KIND_STYLES[node.conceptKind].label : KIND_STYLES[node.kind].label}</span>
                  {node.more > 0 ? <span className={styles.listMore}>+{node.more} more</span> : null}
                </button>
                {edgesUnder.get(node.id)?.length ? (
                  <ul className={styles.listEdges}>
                    {edgesUnder.get(node.id)?.map((edge) => (
                      <li key={edge.id}>
                        <button
                          type="button"
                          data-item=""
                          className={styles.listEdge}
                          aria-pressed={isSel('edge', edge.id)}
                          onClick={() => onSelect({ kind: 'edge', id: edge.id })}
                          onFocus={() => onHighlight(node.id)}
                        >
                          {edgeLine(edge, node.id, byId)}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Flows and systems as Mermaid. Server output is the text version (every node and
 * edge as a list), which is also what screen readers get. In the browser Mermaid is
 * lazy-loaded only when a diagram is on the page and re-rendered on theme change.
 */
import { useEffect, useMemo, useState } from 'react';
import type { DiagramBlock as Diagram } from '../../lib/contract';
import { renderDiagram, toMermaid } from '../../lib/mermaid';
import { THEME_CHANGE_EVENT } from '../../lib/theme';
import { BlockFigure } from './BlockFigure';
import styles from './Diagram.module.css';

function TextVersion({ block }: { block: Diagram }) {
  const labels = new Map(block.nodes.map((n) => [n.id, n.label]));
  const name = (id: string) => labels.get(id) ?? id;
  const linked = new Set(block.edges.flatMap((e) => [e.from, e.to]));
  const loose = block.nodes.filter((n) => !linked.has(n.id));
  return (
    <ul className={styles.text}>
      {block.edges.map((edge, i) => (
        <li key={i}>
          <span className={styles.node}>{name(edge.from)}</span>
          <span className={styles.arrow}>
            {' '}
            {edge.label ? <em>{edge.label}</em> : null}
            <span aria-hidden="true"> → </span>
            <span className="visually-hidden">{edge.label ? ' to ' : ' leads to '}</span>
          </span>
          <span className={styles.node}>{name(edge.to)}</span>
        </li>
      ))}
      {loose.map((node) => (
        <li key={node.id}>
          <span className={styles.node}>{node.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function DiagramBlock({ block }: { block: Diagram }) {
  const source = useMemo(() => toMermaid(block), [block]);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const render = () => {
      renderDiagram(source)
        .then((out) => {
          if (!cancelled) setSvg(out);
        })
        .catch(() => {
          // The text version stays visible.
        });
    };
    render();
    window.addEventListener(THEME_CHANGE_EVENT, render);
    return () => {
      cancelled = true;
      window.removeEventListener(THEME_CHANGE_EVENT, render);
    };
  }, [source]);

  return (
    <BlockFigure
      kind="diagram"
      cites={block.cites}
      confidence={block.confidence}
      attrs={{ 'data-rendered': svg ? '' : undefined }}
    >
      <div
        className={styles.canvas}
        data-mermaid={svg ? undefined : source}
        aria-hidden="true"
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <div className={styles.fallback}>
        <TextVersion block={block} />
      </div>
    </BlockFigure>
  );
}

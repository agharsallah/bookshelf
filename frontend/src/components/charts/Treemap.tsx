/**
 * Where the time went, as nested areas: each group (a book) a color, each leaf (a chapter)
 * a tile sized by its time, separated by the 2px surface gap. Labels sit inside a tile only
 * when they fit; every tile has its tooltip and may link.
 */
import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
import { useWidth } from './chart';
import { Legend } from './Legend';
import { Frame, Tooltip, useTooltip } from './Tooltip';
import styles from './Charts.module.css';

export interface TreeLeaf {
  key: string;
  label: string;
  value: number;
  href?: string;
}

export interface TreeGroup {
  key: string;
  label: string;
  color: string;
  leaves: TreeLeaf[];
}

export interface TreemapProps {
  groups: readonly TreeGroup[];
  format: (value: number) => string;
  label: string;
  height?: number;
}

interface Datum {
  key: string;
  label: string;
  value?: number;
  href?: string;
  color?: string;
  children?: Datum[];
}
const CHAR_PX = 6.2; // an 11px UI font's average glyph, to decide whether a label fits

export function Treemap({ groups, format, label, height = 320 }: TreemapProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const { tip, show, hide } = useTooltip();
  const shown = groups.map((g) => ({ ...g, leaves: g.leaves.filter((l) => l.value > 0) })).filter((g) => g.leaves.length > 0);
  if (shown.length === 0) return <p className={styles.empty}>No tracked time yet.</p>;
  const data: Datum = { key: 'root', label, children: shown.map((g) => ({ key: g.key, label: g.label, color: g.color, children: g.leaves })) };
  const root = treemap<Datum>()
    .tile(treemapSquarify)
    .size([width, height])
    .paddingInner(2)
    .paddingOuter(0)
    .round(true)(hierarchy(data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0)));
  const total = root.value ?? 0;
  const leaves = root.leaves() as HierarchyRectangularNode<Datum>[];

  return (
    <Frame label={label} frameRef={ref}>
      <Legend series={shown.map((g) => ({ key: g.key, label: g.label, color: g.color }))} />
      <svg className={styles.svg} width={width} height={height} role="img" aria-label={label} onPointerLeave={hide}>
        {leaves.map((leaf) => {
          const group = leaf.parent?.data;
          const w = leaf.x1 - leaf.x0;
          const h = leaf.y1 - leaf.y0;
          const value = leaf.value ?? 0;
          const open = () =>
            show({
              x: leaf.x0 + w / 2,
              y: leaf.y0 + h / 2,
              title: leaf.data.label,
              rows: [
                { label: 'time', value: format(value), color: group?.color },
                { label: group?.label ?? '', value: `${Math.round((value / Math.max(1, leaf.parent?.value ?? 1)) * 100)}% of the book` },
                { label: 'of all tracked time', value: `${Math.round((value / Math.max(1, total)) * 100)}%` },
              ],
            });
          const fits = w > leaf.data.label.length * CHAR_PX + 12 && h > 30;
          const tile = (
            <g className={styles.mark} tabIndex={0} aria-label={`${leaf.data.label}: ${format(value)}`} onPointerEnter={open} onFocus={open} onBlur={hide}>
              <rect x={leaf.x0} y={leaf.y0} width={w} height={h} rx={3} fill={group?.color} />
              {fits ? (
                <>
                  <text className={styles.onFill} x={leaf.x0 + 6} y={leaf.y0 + 15}>
                    {leaf.data.label}
                  </text>
                  <text className={styles.onFillMuted} x={leaf.x0 + 6} y={leaf.y0 + 28}>
                    {format(value)}
                  </text>
                </>
              ) : null}
            </g>
          );
          return leaf.data.href ? (
            <a key={`${group?.key}:${leaf.data.key}`} href={leaf.data.href}>
              {tile}
            </a>
          ) : (
            <g key={`${group?.key}:${leaf.data.key}`}>{tile}</g>
          );
        })}
      </svg>
      <Tooltip tip={tip} width={width} />
    </Frame>
  );
}

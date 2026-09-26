/**
 * The margin while tracing a path: pick the other end (on the map, or by name), then
 * read the chain hop by hop. Each hop is the line as it reads ("Stories mentions little's
 * law"), with the passage that shows it one click away in the reader.
 */
import { useId, useState } from 'react';
import type { AtlasNode } from '../../lib/api/types/graph';
import { readerHref } from '../search/links';
import { KindMark, RelationMark } from '../graph/Legend';
import { LINK_STYLES } from '../graph/styles';
import type { AtlasIndex } from './model';
import type { Hop } from './paths';
import graph from '../graph/Graph.module.css';
import styles from './Atlas.module.css';

export interface PathPanelProps {
  index: AtlasIndex;
  from: AtlasNode;
  to: AtlasNode | null;
  /** null: no chain joins them; undefined: no other end yet. */
  hops: Hop[] | null | undefined;
  onPickTo: (id: string) => void;
  onSelect: (id: string) => void;
  onSwap: () => void;
  onClear: () => void;
}

function optionLabel(n: AtlasNode): string {
  return n.kind === 'chapter' && n.sublabel ? `${n.label} (${n.sublabel})` : n.label;
}

/** Where to read what a hop claims: its first evidence passage, else the chapter. */
export function hopHref(index: AtlasIndex, hop: Hop): string | null {
  const [ref] = hop.edge.evidence;
  if (ref) {
    const [doc, anchor] = ref.split('#');
    const slug = index.byId.get(`document:${doc}`)?.document?.slug;
    if (slug && anchor) return readerHref(slug, anchor);
  }
  const chapter = [hop.from, hop.to].find((n) => n.kind === 'chapter');
  return chapter?.document ? readerHref(chapter.document.slug, chapter.anchor) : null;
}

function sentence(hop: Hop): [string, string, string] {
  const [src, dst] = hop.forward ? [hop.from, hop.to] : [hop.to, hop.from];
  return [src.label, LINK_STYLES[hop.edge.relation].verb, dst.label];
}

export function PathPanel({ index, from, to, hops, onPickTo, onSelect, onSwap, onClear }: PathPanelProps) {
  const listId = useId();
  const [typed, setTyped] = useState('');
  const options = index.atlas.nodes.filter((n) => n.id !== from.id);
  const byLabel = new Map(options.map((n) => [optionLabel(n), n.id]));
  const pick = (value: string) => {
    setTyped(value);
    const id = byLabel.get(value);
    if (id) onPickTo(id);
  };

  return (
    <div className={graph.panelBody}>
      <p className={graph.panelKind}>Path</p>
      <h2 className={graph.panelTitle}>
        {from.label} <em className={graph.verb}>to</em> {to ? to.label : '…'}
      </h2>
      {!to ? (
        <>
          <p className={graph.panelMeta}>Click the other end on the map, or name it.</p>
          <label className={styles.search}>
            <span className={styles.srOnly}>The other end</span>
            <input list={listId} placeholder="A concept, chapter or book…" value={typed} onChange={(e) => pick(e.target.value)} />
            <datalist id={listId}>
              {options.map((n) => (
                <option key={n.id} value={optionLabel(n)} />
              ))}
            </datalist>
          </label>
        </>
      ) : hops === null ? (
        <p className={graph.panelMeta}>Nothing on the shelf joins these two yet.</p>
      ) : hops && hops.length ? (
        <>
          <p className={graph.panelMeta}>{hops.length === 1 ? 'One step' : `${hops.length} steps`}, the strongest chain the shelf holds.</p>
          <ol className={styles.hops}>
            {hops.map((hop, i) => {
              const [src, verb, dst] = sentence(hop);
              const href = hopHref(index, hop);
              return (
                <li key={hop.edge.id} className={styles.hop}>
                  <button type="button" className={styles.pick} onClick={() => onSelect(hop.from.id)}>
                    <KindMark kind={hop.from.kind === 'chapter' ? 'node' : hop.from.kind} />
                    <span>{hop.from.label}</span>
                  </button>
                  <div className={styles.hopLine}>
                    <RelationMark relation={hop.edge.relation} proposed={hop.edge.status === 'proposed'} />
                    <span>
                      {src} <em>{verb}</em> {dst}
                      {hop.edge.status === 'proposed' ? ' (proposed)' : ''}
                    </span>
                    {href ? (
                      <a className={styles.read} href={href} aria-label={`Read step ${i + 1}`}>
                        Read
                      </a>
                    ) : null}
                  </div>
                  {i === hops.length - 1 ? (
                    <button type="button" className={styles.pick} onClick={() => onSelect(hop.to.id)}>
                      <KindMark kind={hop.to.kind === 'chapter' ? 'node' : hop.to.kind} />
                      <span>{hop.to.label}</span>
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
      <div className={graph.panelActions}>
        {to ? (
          <button type="button" className={graph.actionQuiet} onClick={onSwap}>
            Swap ends
          </button>
        ) : null}
        <button type="button" className={graph.actionQuiet} onClick={onClear}>
          Done
        </button>
      </div>
    </div>
  );
}

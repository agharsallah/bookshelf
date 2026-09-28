/**
 * What a selected node is, where to read it, and how to move to it: its kind, label and
 * blurb or passage, links to the concept page or the reader, "focus here", and how
 * many neighbours lie beyond this view.
 */
import { anchorLabel } from '../../lib/anchors';
import { conceptHref, documentHref, readerHref } from '../search/links';
import type { ModelNode } from './model';
import { parseRef } from './refs';
import { KindMark } from './Legend';
import { CONCEPT_KIND_STYLES, KIND_STYLES } from './styles';
import styles from './Graph.module.css';

export interface NodeDetailProps {
  node: ModelNode;
  isFocus: boolean;
  onFocus: (id: string) => void;
}

function links(node: ModelNode): { href: string; label: string }[] {
  const doc = node.data.document;
  const parsed = parseRef(node.id);
  switch (node.kind) {
    case 'concept':
      return parsed ? [{ href: conceptHref(parsed.id), label: 'Open the concept page' }] : [];
    case 'document':
      return doc ? [{ href: documentHref(doc.slug), label: 'Open the book' }] : [];
    // A claim sits at its first evidence anchor in its paper.
    case 'node':
    case 'artifact':
    case 'claim':
      return doc ? [{ href: readerHref(doc.slug, node.data.anchor), label: 'Read it in context' }] : [];
  }
}

export function NodeDetail({ node, isFocus, onFocus }: NodeDetailProps) {
  const { data } = node;
  const passage = node.kind === 'node';
  return (
    <div className={styles.panelBody}>
      <p className={styles.panelKind}>
        <KindMark kind={node.kind} conceptKind={node.conceptKind} />
        {node.conceptKind ? CONCEPT_KIND_STYLES[node.conceptKind].label : KIND_STYLES[node.kind].label}
        {passage && data.anchor ? <span className={styles.panelPlace}>{anchorLabel(data.anchor)}</span> : null}
      </p>
      {passage ? (
        <blockquote className={styles.panelQuote}>{node.label}</blockquote>
      ) : (
        <h2 className={styles.panelTitle}>{node.label}</h2>
      )}
      {data.sublabel && !node.conceptKind ? <p className={styles.panelMeta}>{data.sublabel}</p> : null}
      {data.blurb ? <p className={styles.panelBlurb}>{data.blurb}</p> : null}
      <div className={styles.panelActions}>
        {isFocus ? null : (
          <button type="button" className={styles.action} onClick={() => onFocus(node.id)}>
            Focus here
          </button>
        )}
        {links(node).map((l) => (
          <a key={l.href} className={styles.actionLink} href={l.href}>
            {l.label}
          </a>
        ))}
      </div>
      {node.more > 0 ? (
        <p className={styles.panelMeta}>
          {node.more === 1 ? 'One more connection' : `${node.more} more connections`} beyond this view.
          {isFocus ? ' Switch to two steps, or show more, to see them.' : ' Focus here to see them.'}
        </p>
      ) : null}
    </div>
  );
}

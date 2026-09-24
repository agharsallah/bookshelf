/**
 * One source block in the reader's left pane. Text-bearing kinds render as runs
 * (`data-o` = offset into the node's text) so selections map back to character
 * ranges and highlights can split them. Every block carries its anchor as `id`,
 * a margin page marker when the page changes, and a hover handle to copy its link.
 * Its semantic role (semantics.ts) rides along as `data-role` with a label; both
 * only show when the reader's colour-coded mode is on.
 */
import { memo, type ReactNode } from 'react';
import type { TreeNode } from '../../lib/api/types/documents';
import { clip, pieces, segment, topColor, type Mark, type Piece, type Segment } from './segments';
import { isPassage, roleOf } from './semantics';
import spanStyles from '../blocks/Spans.module.css';
import styles from './SourceBlock.module.css';

export interface SourceBlockProps {
  node: TreeNode;
  marks: readonly Mark[];
  /** Page to show in the margin when it differs from the previous block's. */
  page: number | null;
  /** Pre-highlighted HTML for code blocks (Shiki, server-side). */
  codeHtml?: string | undefined;
  hasBlockNote: boolean;
  /** Section depth below the unit, for heading levels. */
  level: number;
}

export const TEXT_KINDS = new Set(['paragraph', 'list', 'quote', 'aside']);

function Runs({ text, segments, piece }: { text: string; segments: Segment[]; piece: Piece }) {
  return (
    <>
      {clip(segments, piece).map((seg) => {
        const run = (
          <span data-o={seg.start} key={seg.start}>
            {text.slice(seg.start, seg.end)}
          </span>
        );
        if (seg.marks.length === 0) return run;
        return (
          <mark
            key={seg.start}
            className={spanStyles.highlight}
            data-color={topColor(seg) ?? 'amber'}
            data-notes={seg.marks.map((m) => m.id).join(' ')}
            data-overlap={seg.marks.length > 1 ? '' : undefined}
          >
            {run}
          </mark>
        );
      })}
    </>
  );
}

function body(node: TreeNode, marks: readonly Mark[], codeHtml: string | undefined, level: number): ReactNode {
  const text = node.text ?? '';
  const segments = TEXT_KINDS.has(node.kind) ? segment(text.length, marks) : [];
  const lines = (strip = false) => pieces(text, { stripMarkers: strip });
  switch (node.kind) {
    case 'section': {
      const Tag = level <= 1 ? 'h2' : level === 2 ? 'h3' : 'h4';
      return <Tag className={styles.heading}>{node.heading}</Tag>;
    }
    case 'paragraph':
      return (
        <p className={styles.text}>
          {lines().map((piece, i) => (
            <span key={piece.start}>
              {i > 0 ? <br /> : null}
              <Runs text={text} segments={segments} piece={piece} />
            </span>
          ))}
        </p>
      );
    case 'list': {
      const Tag = node.meta.ordered ? 'ol' : 'ul';
      return (
        <Tag className={styles.list}>
          {lines(true).map((piece) => (
            <li key={piece.start}>
              <Runs text={text} segments={segments} piece={piece} />
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className={styles.quote}>
          {lines().map((piece) => (
            <p key={piece.start}>
              <Runs text={text} segments={segments} piece={piece} />
            </p>
          ))}
        </blockquote>
      );
    case 'aside':
      return (
        <aside className={styles.aside}>
          {node.meta.label ? <p className={styles.asideLabel}>{node.meta.label}</p> : null}
          {lines().map((piece) => (
            <p key={piece.start}>
              <Runs text={text} segments={segments} piece={piece} />
            </p>
          ))}
        </aside>
      );
    case 'table': {
      const table = node.meta.table;
      if (!table) return <pre className={styles.pre}>{text}</pre>;
      return (
        <figure className={styles.figure}>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>{table.header.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>{row.map((cell, c) => <td key={c}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {node.meta.caption ? <figcaption>{node.meta.caption}</figcaption> : null}
        </figure>
      );
    }
    case 'figure':
      return (
        <figure className={styles.figure}>
          {node.meta.image_path ? (
            <img
              className={styles.image}
              src={`/api/media/${node.meta.image_path}`}
              alt={node.meta.caption ?? (text || 'Figure')}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <p className={styles.missing}>The figure image was not extracted.</p>
          )}
          {node.meta.caption || text ? <figcaption>{node.meta.caption ?? text}</figcaption> : null}
        </figure>
      );
    case 'code':
      return (
        <figure className={styles.figure}>
          {codeHtml ? (
            <div className={styles.code} dangerouslySetInnerHTML={{ __html: codeHtml }} />
          ) : (
            <pre className={styles.pre}>
              <code>{text}</code>
            </pre>
          )}
          {node.meta.caption ? <figcaption>{node.meta.caption}</figcaption> : null}
        </figure>
      );
    case 'math':
      return node.meta.image_path ? (
        <img className={styles.math} src={`/api/media/${node.meta.image_path}`} alt={text || 'Formula'} loading="lazy" />
      ) : (
        <pre className={styles.pre}>{text}</pre>
      );
    default:
      return text ? <p className={styles.text}>{text}</p> : null;
  }
}

function SourceBlockImpl({ node, marks, page, codeHtml, hasBlockNote, level }: SourceBlockProps) {
  const role = roleOf(node);
  return (
    <div
      id={node.anchor}
      className={styles.block}
      data-source-anchor={node.anchor}
      data-kind={node.kind}
      data-role={role?.role}
      data-passage={role && isPassage(role.role) ? '' : undefined}
      tabIndex={-1}
    >
      {role ? <span className={styles.roleLabel}>{role.label}</span> : null}
      {page !== null ? (
        <span className={styles.page} aria-label={`Page ${page}`}>
          p. {page}
        </span>
      ) : null}
      {body(node, marks, codeHtml, level)}
      <button type="button" className={styles.handle} data-copy-anchor={node.anchor} aria-label={`Copy link to ${node.anchor}`}>
        #
      </button>
      {hasBlockNote ? <span className={styles.noteMark} data-block-note={node.anchor} title="This block has a note" /> : null}
    </div>
  );
}

export const SourceBlock = memo(SourceBlockImpl);

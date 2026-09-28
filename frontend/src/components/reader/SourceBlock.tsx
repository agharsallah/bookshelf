/**
 * One source block in the reader's left pane. Text-bearing kinds render as runs
 * (`data-o` = offset into the node's text) so selections map back to character
 * ranges and highlights can split them. Every block carries its anchor as `id`,
 * a margin page marker when the page changes, and a hover handle to copy its link.
 * Its semantic role (semantics.ts) rides along as `data-role` with a label; both
 * only show when the reader's colour-coded mode is on. "What matters" marks
 * (salience.ts) ride on the runs as `data-sal` / `data-term`, shown only in that mode.
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import type { TreeNode } from '../../lib/api/types/documents';
import { mediaSrc } from './figures';
import { clip, pieces, segment, topColor, type Mark, type Piece, type Segment } from './segments';
import { salientRuns, type Salient } from './salience';
import { isPassage, roleOf } from './semantics';
import spanStyles from '../blocks/Spans.module.css';
import styles from './SourceBlock.module.css';

export interface SourceBlockProps {
  node: TreeNode;
  marks: readonly Mark[];
  /** Core ideas, key points and terms in this block (the reader's what-matters mode). */
  salient?: readonly Salient[];
  /** Page to show in the margin when it differs from the previous block's. */
  page: number | null;
  /** Pre-highlighted HTML for code blocks (Shiki, server-side). */
  codeHtml?: string | undefined;
  hasBlockNote: boolean;
  /** Section depth below the unit, for heading levels. */
  level: number;
  /** Extra marks for the left margin (a paper's claim marks, paper/usePaperMode). */
  margin?: ReactNode;
}

export const TEXT_KINDS = new Set(['paragraph', 'list', 'quote', 'aside']);
const NO_SALIENT: readonly Salient[] = Object.freeze([]);

/** Milliseconds per character of a marked sentence's draw-in, so the stroke sweeps at reading pace. */
const DRAW_MS = 7;

/** A run of text at offset `start`; under a salient sentence it carries when its stroke starts and how long it takes. */
function Run({ text, start, end, salient }: { text: string; start: number; end: number; salient: readonly Salient[] }) {
  return salientRuns(start, end, salient).map(({ start: from, end: to, sentence, term }) => (
    <span
      key={from}
      data-o={from}
      data-sal={sentence?.tier}
      data-sal-id={sentence?.id}
      data-sal-first={sentence && from === sentence.start ? '' : undefined}
      data-term={term?.id}
      style={
        sentence
          ? ({ '--sal-delay': `${(from - sentence.start) * DRAW_MS}ms`, '--sal-draw': `${(to - from) * DRAW_MS}ms` } as CSSProperties)
          : undefined
      }
    >
      {text.slice(from, to)}
    </span>
  ));
}

function Runs({ text, segments, piece, salient }: { text: string; segments: Segment[]; piece: Piece; salient: readonly Salient[] }) {
  return (
    <>
      {clip(segments, piece).map((seg) => {
        const run = <Run key={seg.start} text={text} start={seg.start} end={seg.end} salient={salient} />;
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

/** An image that opens in the lightbox: a button the reader's click handler picks up by `data-magnify`. */
function Magnifiable({ anchor, label, children }: { anchor: string; label: string; children: ReactNode }) {
  return (
    <button type="button" className={styles.magnify} data-magnify={anchor} aria-label={`Magnify: ${label}`}>
      {children}
      <span className={styles.magnifyBadge} aria-hidden="true">
        ⤢ Magnify
      </span>
    </button>
  );
}

function body(node: TreeNode, marks: readonly Mark[], salient: readonly Salient[], codeHtml: string | undefined, level: number): ReactNode {
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
              <Runs text={text} segments={segments} piece={piece} salient={salient} />
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
              <Runs text={text} segments={segments} piece={piece} salient={salient} />
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
              <Runs text={text} segments={segments} piece={piece} salient={salient} />
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
              <Runs text={text} segments={segments} piece={piece} salient={salient} />
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
            <Magnifiable anchor={node.anchor} label={node.meta.caption ?? (text || 'figure')}>
              <img
                className={styles.image}
                src={mediaSrc(node.meta.image_path)}
                alt={node.meta.caption ?? (text || 'Figure')}
                loading="lazy"
                decoding="async"
              />
            </Magnifiable>
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
        <Magnifiable anchor={node.anchor} label={text || 'formula'}>
          <img className={styles.math} src={mediaSrc(node.meta.image_path)} alt={text || 'Formula'} loading="lazy" />
        </Magnifiable>
      ) : (
        <pre className={styles.pre}>{text}</pre>
      );
    default:
      return text ? <p className={styles.text}>{text}</p> : null;
  }
}

function SourceBlockImpl({ node, marks, salient = NO_SALIENT, page, codeHtml, hasBlockNote, level, margin }: SourceBlockProps) {
  const role = roleOf(node);
  return (
    <div
      id={node.anchor}
      className={styles.block}
      data-source-anchor={node.anchor}
      data-kind={node.kind}
      data-role={role?.role}
      data-passage={role && isPassage(role.role) ? '' : undefined}
      data-salient={salient.length ? '' : undefined}
      tabIndex={-1}
    >
      {role ? <span className={styles.roleLabel}>{role.label}</span> : null}
      {page !== null ? (
        <span className={styles.page} aria-label={`Page ${page}`}>
          p. {page}
        </span>
      ) : null}
      {margin}
      {body(node, marks, salient, codeHtml, level)}
      <button type="button" className={styles.handle} data-copy-anchor={node.anchor} aria-label={`Copy link to ${node.anchor}`}>
        #
      </button>
      {hasBlockNote ? <span className={styles.noteMark} data-block-note={node.anchor} title="This block has a note" /> : null}
    </div>
  );
}

export const SourceBlock = memo(SourceBlockImpl);

/**
 * The proof: the artifact laid out claim by claim, as a copy-editor would mark a galley.
 * Every span shows its cite chips; spans with none are underlined and labelled
 * "uncited" (what drags grounding down); invalid or low-confidence blocks are flagged.
 * Blocks without claims (headings, charts, diagrams) render through `<Blocks>` as-is.
 */
import { Fragment, useMemo } from 'react';
import { defaultCiteHref } from '../../../lib/anchors';
import type { Anchor, RenderBlock, Span } from '../../../lib/contract';
import { Blocks } from '../../blocks/Blocks';
import { BlockSources, CiteMarks } from '../../blocks/CiteChip';
import { CiteProvider } from '../../blocks/CiteContext';
import { needsSeparator } from '../../blocks/Spans';
import { TONES } from '../../blocks/callout-tones';
import { spanGroups } from '../editor/model';
import { blockProblems } from '../editor/validate';
import { isUncited, tallyGrounding } from './grounding';
import styles from './ProofView.module.css';

function ProofSpans({ spans }: { spans: readonly Span[] }) {
  return (
    <>
      {spans.map((span, i) => {
        const previous = spans[i - 1];
        const uncited = isUncited(span);
        return (
          <Fragment key={i}>
            {previous && needsSeparator(previous.text, span.text) ? ' ' : null}
            <span className={styles.span} data-uncited={uncited || undefined}>
              {span.text}
              {uncited ? <span className={styles.uncitedLabel}> uncited</span> : null}
            </span>
            <CiteMarks anchors={span.cites} />
          </Fragment>
        );
      })}
    </>
  );
}

function gutterLabel(block: RenderBlock): string {
  if (block.type === 'callout') return TONES[block.tone]?.label ?? 'Callout';
  if (block.type === 'definition') return block.term || 'Definition';
  return block.type.charAt(0).toUpperCase() + block.type.slice(1);
}

function ClaimBlock({ block }: { block: RenderBlock }) {
  const groups = spanGroups(block);
  if (block.type === 'table') {
    return (
      <ul className={styles.items} aria-label={block.header.join(', ')}>
        {block.rows.map((row, r) => (
          <li key={r} className={styles.row}>
            {row.map((cell, c) => (
              <span key={c} className={styles.cell}>
                <ProofSpans spans={[cell]} />
              </span>
            ))}
          </li>
        ))}
      </ul>
    );
  }
  if (block.type === 'bullets' || block.type === 'steps') {
    const List = block.type === 'steps' ? 'ol' : 'ul';
    return (
      <List className={styles.items}>
        {groups.map((group, i) => (
          <li key={i}>
            <ProofSpans spans={group} />
          </li>
        ))}
      </List>
    );
  }
  return (
    <p className={styles.text}>
      <ProofSpans spans={groups[0] ?? []} />
    </p>
  );
}

const HAS_CLAIMS = new Set(['paragraph', 'callout', 'definition', 'bullets', 'steps', 'table']);

function ProofBlock({ block, onCite }: { block: RenderBlock; onCite?: ((a: Anchor) => void) | undefined }) {
  const problems = blockProblems(block);
  const lowConfidence = 'confidence' in block && block.confidence === 'low';
  const uncitedBlock = (block.type === 'quote' || block.type === 'code') && block.cites.length === 0;
  return (
    <div
      className={styles.block}
      data-invalid={problems.length > 0 || undefined}
      data-low-confidence={lowConfidence || undefined}
    >
      <span className={styles.gutter}>{gutterLabel(block)}</span>
      <div className={styles.content}>
        {HAS_CLAIMS.has(block.type) ? <ClaimBlock block={block} /> : <Blocks blocks={[block]} onCite={onCite} />}
        {block.type === 'quote' || block.type === 'code' ? null : 'cites' in block ? <BlockSources anchors={block.cites} /> : null}
        {uncitedBlock ? <p className={styles.note}>No source cited for this {block.type}.</p> : null}
        {lowConfidence ? <p className={styles.note}>The skill reported low confidence in this {block.type}.</p> : null}
        {problems.map((problem) => (
          <p key={problem} className={styles.note} data-kind="invalid">
            {problem}
          </p>
        ))}
      </div>
    </div>
  );
}

export interface ProofViewProps {
  blocks: readonly RenderBlock[];
  onCite?: ((anchor: Anchor) => void) | undefined;
}

export function ProofView({ blocks, onCite }: ProofViewProps) {
  const tally = useMemo(() => tallyGrounding(blocks), [blocks]);
  const cite = useMemo(() => ({ onCite, citeHref: defaultCiteHref }), [onCite]);
  const uncited = tally.total - tally.cited;
  return (
    <CiteProvider value={cite}>
      <div className={styles.proof}>
        <p className={styles.summary} role="status">
          {tally.total === 0
            ? 'No claims to ground in this artifact.'
            : `${tally.cited} of ${tally.total} claims cite a source.${uncited ? ` ${uncited} uncited, underlined below.` : ''}`}
        </p>
        {blocks.map((block, index) => (
          <ProofBlock key={index} block={block} onCite={onCite} />
        ))}
      </div>
    </CiteProvider>
  );
}

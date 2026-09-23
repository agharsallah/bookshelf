/** Inline text: marks (strong, em, highlight, code) and the cite chips after each span. */
import { Fragment } from 'react';
import type { HighlightColor, Span } from '../../lib/contract';
import { CiteMarks } from './CiteChip';
import styles from './Spans.module.css';

/**
 * Spans are authored as separate runs and may omit the space between them. Add one
 * when neither side already has whitespace and the next run doesn't open with punctuation.
 */
export function needsSeparator(previous: string, next: string): boolean {
  return !/\s$/.test(previous) && !/^[\s.,;:!?)\]}’”]/.test(next);
}

function Marked({ span, highlight }: { span: Span; highlight: HighlightColor }) {
  switch (span.mark) {
    case 'strong':
      return <strong>{span.text}</strong>;
    case 'em':
      return <em>{span.text}</em>;
    case 'code':
      return <code className={styles.code}>{span.text}</code>;
    case 'highlight':
      return (
        <mark className={styles.highlight} data-color={highlight}>
          {span.text}
        </mark>
      );
    default:
      return <>{span.text}</>;
  }
}

export interface SpansProps {
  spans: readonly Span[];
  /** Color for `mark: "highlight"` spans; notes pass the user's chosen color. */
  highlight?: HighlightColor;
}

export function Spans({ spans, highlight = 'amber' }: SpansProps) {
  return (
    <>
      {spans.map((span, index) => {
        const previous = spans[index - 1];
        return (
          <Fragment key={index}>
            {previous && needsSeparator(previous.text, span.text) ? ' ' : null}
            <Marked span={span} highlight={highlight} />
            <CiteMarks anchors={span.cites} />
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * A small exercise whose worked answer stays hidden until the reader asks for it (and
 * hides again on request). The answer is always in the markup, `hidden` until revealed,
 * so a printout shows it (Math.module.css) and assistive tech reads it once shown.
 */
import { useId, useState } from 'react';
import type { Spans as SpanList } from '../../lib/contract';
import { Spans } from '../blocks/Spans';
import styles from './Math.module.css';

export interface TryItProps {
  question: SpanList;
  answer: SpanList;
}

export function TryIt({ question, answer }: TryItProps) {
  const [shown, setShown] = useState(false);
  const id = useId();
  if (question.length === 0) return null;
  return (
    <div className={styles.tryIt}>
      <p className={styles.tryQuestion}>
        <span className={styles.tryLabel}>Try it</span> <Spans spans={question} />
      </p>
      {answer.length > 0 ? (
        <>
          <button type="button" className="btn" aria-expanded={shown} aria-controls={id} onClick={() => setShown((s) => !s)}>
            {shown ? 'Hide the answer' : 'Show the answer'}
          </button>
          <p id={id} className={styles.tryAnswer} hidden={!shown}>
            <span className={styles.tryLabel}>Answer</span> <Spans spans={answer} />
          </p>
        </>
      ) : null}
    </div>
  );
}

export default TryIt;

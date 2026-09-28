/**
 * "Why it ranks here": the score's terms as a bar list on the page's shared scale, one
 * hue (a single measure needs no legend), each term named and explained in plain words.
 * A term that lowers the score grows left of the zero line. The numbers are text, so the
 * list is its own table view.
 */
import { leadingTerms, scoreTerms, signed } from './score';
import styles from './Next.module.css';

export interface ScoreBreakdownProps {
  parts: Record<string, number>;
  score: number;
  /** The largest term on the page, so every candidate's bars compare. */
  scale: number;
}

/** From the start edge; with a lowering term on show, from a centred zero line instead. */
function barStyle(length: number, lowers: boolean, diverging: boolean) {
  if (!diverging) return { insetInlineStart: 0, inlineSize: `${length * 100}%` };
  return lowers ? { insetInlineEnd: '50%', inlineSize: `${length * 50}%` } : { insetInlineStart: '50%', inlineSize: `${length * 50}%` };
}

export function ScoreBreakdown({ parts, score, scale }: ScoreBreakdownProps) {
  const terms = scoreTerms(parts, scale);
  if (terms.length === 0) return null;
  const lead = leadingTerms(terms);
  const anyLowers = terms.some((t) => t.lowers);
  return (
    <details className={styles.why}>
      <summary>
        <span className={styles.whyLabel}>Why it ranks here</span>
        <span className={styles.whyScore}>score {score.toFixed(2)}</span>
        {lead.length ? <span className={styles.whyLead}>mostly {lead.map((t) => t.name.toLowerCase()).join(' and ')}</span> : null}
      </summary>
      <dl className={styles.terms} data-diverging={anyLowers ? '' : undefined}>
        {terms.map((t) => (
          <div key={t.key} className={styles.term} title={`${t.name}: ${signed(t.value)}. ${t.explain}`}>
            <dt>
              {t.name}
              {t.explain ? <span className={styles.termHint}>{t.explain}</span> : null}
            </dt>
            <dd className={styles.termBar} aria-hidden="true">
              <span className={styles.termTrack}>
                <span className={styles.termFill} data-lowers={t.lowers ? '' : undefined} style={barStyle(t.length, t.lowers, anyLowers)} />
              </span>
            </dd>
            <dd className={styles.termValue}>{signed(t.value)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

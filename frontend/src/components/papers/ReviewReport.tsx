/**
 * The peer-review report (review-paper) as a referee would file it: a summary, strengths,
 * weaknesses with their severity (major first), questions for the authors, missing
 * experiments, and the verdict with the reviewer's confidence. Every line cited.
 */
import type { Spans as SpansData } from '../../lib/contract';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import type { PassageUnit } from '../guide/passage';
import type { PaperReview } from './study-bodies';
import { RECOMMENDATION_LABELS } from './study-labels';
import { useCitedPassages } from './useCitedPassages';
import styles from './Review.module.css';

export interface ReviewReportProps {
  slug: string;
  review: PaperReview;
  units: PassageUnit[];
}

function Items({ title, items, ordered = false }: { title: string; items: SpansData[]; ordered?: boolean }) {
  if (items.length === 0) return null;
  const List = ordered ? 'ol' : 'ul';
  return (
    <div>
      <h3>{title}</h3>
      <List className={styles.items}>
        {items.map((spans, i) => (
          <li key={i}>
            <Spans spans={spans} />
          </li>
        ))}
      </List>
    </div>
  );
}

export function ReviewReport({ slug, review, units }: ReviewReportProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the peer review');
  const { verdict } = review;
  return (
    <CiteProvider value={cite}>
      <div className={styles.report}>
        {verdict.recommendation || verdict.spans.length > 0 ? (
          <div className={styles.verdict} data-recommendation={verdict.recommendation ?? undefined}>
            <p className={styles.recommendation}>
              {verdict.recommendation ? RECOMMENDATION_LABELS[verdict.recommendation] : 'No recommendation'}
              {verdict.confidence > 0 ? (
                <span className={styles.confidence} aria-label={`Confidence ${verdict.confidence} of 5`}>
                  <span aria-hidden="true">
                    {'●'.repeat(verdict.confidence)}
                    {'○'.repeat(5 - verdict.confidence)}
                  </span>{' '}
                  confidence {verdict.confidence} of 5
                </span>
              ) : null}
            </p>
            {verdict.spans.length > 0 ? (
              <p>
                <Spans spans={verdict.spans} />
              </p>
            ) : null}
          </div>
        ) : null}

        {review.summary.length > 0 ? (
          <div>
            <h3>What the paper does</h3>
            <p className={styles.prose}>
              <Spans spans={review.summary} />
            </p>
          </div>
        ) : null}

        <div className={styles.twoUp}>
          <Items title="Strengths" items={review.strengths} />
          {review.weaknesses.length > 0 ? (
            <div>
              <h3>Weaknesses</h3>
              <ul className={styles.items}>
                {review.weaknesses.map((w, i) => (
                  <li key={i} data-severity={w.severity}>
                    <span className={styles.severity}>{w.severity === 'major' ? 'Major' : 'Minor'}</span> <Spans spans={w.spans} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className={styles.twoUp}>
          <Items title="Questions for the authors" items={review.questions} ordered />
          <Items title="Missing experiments" items={review.missingExperiments} />
        </div>
        {overlays}
      </div>
    </CiteProvider>
  );
}

export default ReviewReport;

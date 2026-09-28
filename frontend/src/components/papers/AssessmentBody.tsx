/**
 * The model's assessment (assess-paper): its overall judgement, the six-criterion rubric
 * as horizontal bars on a fixed 1–5 scale (not a radar: bars compare by length) with the
 * cited reason for each score, the reproducibility checklist (icon and word, never colour
 * alone) and the papers on your shelf it relates to.
 */
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import { HBars } from '../charts/HBars';
import type { PassageUnit } from '../guide/passage';
import { checklistRows, checklistSummary, RUBRIC_MAX, RUBRIC_SERIES, rubricRows } from './review';
import type { PaperAssessment } from './study-bodies';
import { CRITERION_LABELS } from './study-labels';
import { paperHref } from './tabs';
import { useCitedPassages } from './useCitedPassages';
import styles from './Review.module.css';

export interface AssessmentBodyProps {
  slug: string;
  assessment: PaperAssessment;
  units: PassageUnit[];
  /** Shelf titles by slug, for the related papers (a slug not on the shelf shows as is). */
  titles: Record<string, string>;
}

export function AssessmentBody({ slug, assessment, units, titles }: AssessmentBodyProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the assessment');
  const checklist = checklistRows(assessment.reproducibility);
  return (
    <CiteProvider value={cite}>
      <div className={styles.stack}>
        {assessment.overall.length > 0 ? (
          <p className={styles.overall}>
            <Spans spans={assessment.overall} />
          </p>
        ) : null}

        {assessment.scores.length > 0 ? (
          <div className={styles.rubric}>
            <h3>Scores, 1 to {RUBRIC_MAX}</h3>
            <HBars rows={rubricRows(assessment)} series={RUBRIC_SERIES} max={RUBRIC_MAX} format={(v) => String(v)} label="The model’s scores" />
            <dl className={styles.reasons}>
              {assessment.scores.map((s) => (
                <div key={s.criterion}>
                  <dt>
                    {CRITERION_LABELS[s.criterion]} <span className={styles.score}>{s.score}</span>
                  </dt>
                  <dd>
                    <Spans spans={s.spans} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {checklist.length > 0 ? (
          <div>
            <h3>Could you reproduce it?</h3>
            <p className={styles.checkSummary}>{checklistSummary(assessment.reproducibility)}</p>
            <ul className={styles.checklist}>
              {checklist.map((row) => (
                <li key={row.item} data-tone={row.mark.tone}>
                  <span className={styles.mark} aria-hidden="true">
                    {row.mark.icon}
                  </span>
                  <span className={styles.checkName}>
                    {row.name}
                    <span className={styles.checkStatus}>{row.mark.label}</span>
                  </span>
                  <span className={styles.checkWhy}>
                    <Spans spans={row.spans} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {assessment.relatedShelf.length > 0 ? (
          <div>
            <h3>Related on your shelf</h3>
            <ul className={styles.related}>
              {assessment.relatedShelf.map((r) => (
                <li key={r.slug}>
                  <a href={paperHref(r.slug)}>{titles[r.slug] ?? r.slug}</a>
                  <span>
                    <Spans spans={r.why} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {overlays}
      </div>
    </CiteProvider>
  );
}

export default AssessmentBody;

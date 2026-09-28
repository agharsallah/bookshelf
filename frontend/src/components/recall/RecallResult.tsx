/**
 * A graded recall: how many of the chapter's key ideas you recalled, your prediction
 * against what the chapter argues, the "why" question, and every idea with one line of
 * feedback and a chip to its passage, missed ones first.
 */
import type { RecallGrade } from '../../lib/api/types/recalls';
import { Spans } from '../blocks/Spans';
import { byStatus, STATUS_LABELS, tally } from './grade';
import styles from './Recall.module.css';

export interface RecallResultProps {
  grade: RecallGrade;
}

function score(grade: RecallGrade): string {
  const t = tally(grade);
  const partly = t.partial ? `, ${t.partial} partly` : '';
  return `You recalled ${t.recalled} of ${t.total} key ideas${partly}.`;
}

export function RecallResult({ grade }: RecallResultProps) {
  const { comparison, question } = grade;
  return (
    <>
      <p className={styles.score}>{score(grade)}</p>
      {comparison ? (
        <section className={styles.panel} aria-label="Your prediction">
          <p className={styles.panelLabel}>Your prediction</p>
          <p>
            You predicted {comparison.predicted}; <Spans spans={[{ text: `it argues ${comparison.argues}`, cites: comparison.cites }]} />
          </p>
        </section>
      ) : null}
      {question ? (
        <section className={styles.panel} aria-label="Why is it true?">
          <p className={styles.panelLabel}>One question to think through</p>
          <p>
            <Spans spans={[{ text: question.text, cites: question.cites }]} />
          </p>
          <p className={styles.hint}>It is waiting in today’s reviews on the Desk, with the passage that answers it.</p>
        </section>
      ) : null}
      {byStatus(grade).map(([status, ideas]) => (
        <section key={status} className={styles.group} aria-label={STATUS_LABELS[status]}>
          <h3 className={styles.groupTitle}>
            {STATUS_LABELS[status]} · {ideas.length}
          </h3>
          <ul className={styles.ideas}>
            {ideas.map((idea) => (
              <li key={idea.id} className={styles.idea} data-status={status}>
                <span className={styles.feedback}>{idea.feedback}</span>
                <span className={styles.passage}>
                  <Spans spans={[{ text: idea.text, cites: idea.cites }]} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {grade.ideas.some((i) => i.status !== 'recalled') ? (
        <p className={styles.hint}>What you missed comes back for review tomorrow, as a question.</p>
      ) : null}
    </>
  );
}

/** A build plan, read as a document: summary, stack, milestones, layout, and what it leaves out. */
import type { BuildPlan } from '../../lib/api/types/builds';
import fields from './Fields.module.css';
import styles from './Plan.module.css';

function List({ title, items, tone }: { title: string; items: readonly string[]; tone?: 'question' }) {
  if (items.length === 0) return null;
  return (
    <section className={tone === 'question' ? styles.questions : styles.aside}>
      <h4 className={styles.subhead}>{title}</h4>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function PlanView({ plan }: { plan: BuildPlan }) {
  return (
    <div className={styles.plan}>
      <p className={styles.summary}>{plan.summary}</p>
      {plan.stack.length > 0 ? (
        <ul className={fields.chips} aria-label="Stack">
          {plan.stack.map((s) => (
            <li key={s} className={fields.chip}>
              {s}
            </li>
          ))}
        </ul>
      ) : null}
      <List title="The planner would like to know" items={plan.questions} tone="question" />

      <section>
        <h4 className={styles.subhead}>Milestones</h4>
        <ol className={styles.milestones}>
          {plan.milestones.map((m, i) => (
            <li key={i} className={styles.milestone}>
              <p className={styles.milestoneTitle}>{m.title}</p>
              <code className={styles.commit}>{m.commit}</code>
              {m.deliverable ? <p className={styles.deliverable}>{m.deliverable}</p> : null}
              {m.done_when ? (
                <p className={styles.doneWhen}>
                  <span>Done when</span> {m.done_when}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {plan.layout.length > 0 ? (
        <section>
          <h4 className={styles.subhead}>Layout</h4>
          <dl className={styles.layout}>
            {plan.layout.map((entry) => (
              <div key={entry.path}>
                <dt>
                  <code>{entry.path}</code>
                </dt>
                <dd>{entry.purpose}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <div className={styles.asides}>
        <List title="Out of scope" items={plan.out_of_scope} />
        <List title="Risks" items={plan.risks} />
      </div>
    </div>
  );
}

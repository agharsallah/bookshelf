/**
 * The "Math, explained" tab's island (skills/explain-math): the big picture with its math
 * map, then one card per formula in learning order — the formula in KaTeX, read aloud, its
 * symbols as chips, why it has this shape, a picture of it, a worked example to follow by
 * hand, why the paper needs it and what it buys, the usual confusion, an exercise with a
 * reveal, where to go next — then the learning path with minutes, the glossary and why it
 * is beautiful. Cites open their passage in place, as on every paper tab.
 */
import 'katex/dist/katex.min.css';
import type { RenderBlock } from '../../lib/contract';
import type { PreparedBlock } from '../../lib/prepare';
import { Blocks } from '../blocks/Blocks';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import type { PassageUnit } from '../guide/passage';
import { formulaId, minutesLabel, pathItems, totalMinutes, type ExplainedFormula, type MathExplainer } from './math-explainer';
import { TryIt } from './TryIt';
import { useCitedPassages } from './useCitedPassages';
import styles from './Math.module.css';

/** A formula with its display math pre-rendered (`prepareBlocks`). */
export type ShownFormula = ExplainedFormula & { display: PreparedBlock | null };

export interface MathExplainerBodyProps {
  slug: string;
  explainer: Omit<MathExplainer, 'formulas'> & { formulas: ShownFormula[] };
  units: PassageUnit[];
}

const conceptHref = (canonical: string) => `/search?q=${encodeURIComponent(canonical)}`;
const webSearch = (term: string) => `https://duckduckgo.com/?q=${encodeURIComponent(term)}`;

function Formula({ formula, n, cite }: { formula: ShownFormula; n: number; cite: ReturnType<typeof useCitedPassages>['cite'] }) {
  const { example, explore } = formula;
  const exampleBlocks: RenderBlock[] = [...(example.steps ? [example.steps] : []), ...(example.extra ? [example.extra] : [])];
  return (
    <article id={formulaId(formula.anchor)} className={styles.card} aria-labelledby={`${formulaId(formula.anchor)}-name`}>
      <header className={styles.cardHead}>
        <span className={styles.number} aria-hidden="true">
          {n}
        </span>
        <h3 id={`${formulaId(formula.anchor)}-name`}>{formula.name}</h3>
      </header>

      {formula.display ? <Blocks blocks={[formula.display]} {...cite} /> : null}
      {formula.inPlainWords.length > 0 ? (
        <p className={styles.aloud}>
          <span className={styles.label}>Read aloud</span> <Spans spans={formula.inPlainWords} />
        </p>
      ) : null}

      {formula.symbols.length > 0 ? (
        <dl className={styles.symbols} aria-label="What each symbol stands for">
          {formula.symbols.map((s) => (
            <div key={s.latex} className={styles.chip}>
              <dt>{s.html ? <span dangerouslySetInnerHTML={{ __html: s.html }} /> : <code>{s.latex}</code>}</dt>
              <dd>
                <Spans spans={s.everyday} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {formula.intuition.length > 0 ? (
        <section className={styles.part}>
          <h4>Why it has this shape</h4>
          <p>
            <Spans spans={formula.intuition} />
          </p>
        </section>
      ) : null}
      {formula.diagram ? <Blocks blocks={[formula.diagram]} {...cite} /> : null}

      {example.setup.length + exampleBlocks.length + example.result.length > 0 ? (
        <section className={`${styles.part} ${styles.example}`}>
          <h4>Work it out by hand</h4>
          {example.setup.length > 0 ? (
            <p>
              <Spans spans={example.setup} />
            </p>
          ) : null}
          <Blocks blocks={exampleBlocks} {...cite} />
          {example.result.length > 0 ? (
            <p className={styles.result}>
              <Spans spans={example.result} />
            </p>
          ) : null}
        </section>
      ) : null}

      <div className={styles.pair}>
        {formula.whyHere.length > 0 ? (
          <section className={styles.part}>
            <h4>Why the paper needs it</h4>
            <p>
              <Spans spans={formula.whyHere} />
            </p>
          </section>
        ) : null}
        {formula.addedValue.length > 0 ? (
          <section className={styles.part}>
            <h4>What it buys</h4>
            <p>
              <Spans spans={formula.addedValue} />
            </p>
          </section>
        ) : null}
      </div>

      {formula.confusion ? <Blocks blocks={[formula.confusion]} {...cite} /> : null}
      <TryIt question={formula.tryIt.question} answer={formula.tryIt.answer} />

      {explore.prerequisites.length + explore.searchTerms.length + explore.nextQuestion.length > 0 ? (
        <section className={`${styles.part} ${styles.explore}`}>
          <h4>Explore further</h4>
          <ul>
            {explore.prerequisites.map((p) => (
              <li key={`learn-${p.concept}`}>
                Learn <strong>{p.concept}</strong>
                {p.shelfConcept ? (
                  <>
                    {' '}
                    <a href={conceptHref(p.shelfConcept)} title={`On your shelf as “${p.shelfConcept}”`}>
                      on your shelf
                    </a>
                  </>
                ) : null}
              </li>
            ))}
            {explore.searchTerms.map((t) => (
              <li key={`search-${t}`}>
                Search for{' '}
                <a href={webSearch(t)} rel="noopener noreferrer" target="_blank">
                  “{t}”
                </a>
              </li>
            ))}
            {explore.nextQuestion.length > 0 ? (
              <li>
                Next question: <Spans spans={explore.nextQuestion} />
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

export function MathExplainerBody({ slug, explainer, units }: MathExplainerBodyProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the math explainer');
  const path = pathItems(explainer);
  const minutes = totalMinutes(explainer.path);

  return (
    <CiteProvider value={cite}>
      <div className={styles.math}>
        {explainer.problem.length > 0 || explainer.map ? (
          <section className={styles.picture} aria-labelledby="math-picture">
            <h2 id="math-picture">The big picture</h2>
            {explainer.problem.length > 0 ? (
              <p className={styles.problem}>
                <Spans spans={explainer.problem} />
              </p>
            ) : null}
            {explainer.map ? (
              <figure className={styles.map}>
                <Blocks blocks={[explainer.map]} {...cite} />
                <figcaption>The math map: how the formulas feed each other and the paper’s result.</figcaption>
              </figure>
            ) : null}
          </section>
        ) : null}

        {explainer.formulas.length > 0 ? (
          <section aria-labelledby="math-formulas" className={styles.formulas}>
            <h2 id="math-formulas">The formulas, one at a time</h2>
            {explainer.formulas.map((f, i) => (
              <Formula key={f.anchor || i} formula={f} n={i + 1} cite={cite} />
            ))}
          </section>
        ) : null}

        {path.length > 0 ? (
          <section aria-labelledby="math-path" className={styles.pathPart}>
            <h2 id="math-path">
              A learning path <span className={styles.total}>{minutesLabel(minutes)} in all</span>
            </h2>
            <ol className={styles.path}>
              {path.map((step, i) => (
                <li key={i}>
                  <span className={styles.minutes}>{step.minutes} min</span>
                  <span className={styles.stepTitle}>
                    {step.formula && step.formulaNumber ? <a href={`#${formulaId(step.formula)}`}>{step.title}</a> : step.title}
                  </span>
                  {step.goal.length > 0 ? (
                    <span className={styles.goal}>
                      <Spans spans={step.goal} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {explainer.glossary.length > 0 ? (
          <section aria-labelledby="math-glossary" className={styles.glossary}>
            <h2 id="math-glossary">The maths words</h2>
            <Blocks blocks={explainer.glossary} {...cite} />
          </section>
        ) : null}

        {explainer.loveNote ? (
          <section aria-label="Why this is beautiful" className={styles.love}>
            <Blocks blocks={[explainer.loveNote]} {...cite} />
          </section>
        ) : null}
        {overlays}
      </div>
    </CiteProvider>
  );
}

export default MathExplainerBody;

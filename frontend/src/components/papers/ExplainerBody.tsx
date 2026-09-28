/**
 * One level of the paper explainer (simplify-paper's `paper_explainer`): what to know
 * first (linked to the shelf's concept when one matches), the idea, a walkthrough, an
 * analogy with where it breaks, and the key equations read in plain words.
 */
import type { PreparedBlock } from '../../lib/prepare';
import { Blocks } from '../blocks/Blocks';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import type { PassageUnit } from '../guide/passage';
import type { PaperExplainer } from './bodies';
import { useCitedPassages } from './useCitedPassages';
import styles from './PaperViews.module.css';

export interface ExplainerBodyProps {
  slug: string;
  /** Block parts and equations passed through `prepareBlocks`. */
  explainer: Omit<PaperExplainer, 'equations'> & { intuition: PreparedBlock[]; walkthrough: PreparedBlock[]; equations: PreparedBlock[] };
  units: PassageUnit[];
}

const conceptHref = (canonical: string) => `/search?q=${encodeURIComponent(canonical)}`;

export function ExplainerBody({ slug, explainer, units }: ExplainerBodyProps) {
  const { cite, onMagnify, overlays } = useCitedPassages(slug, units, 'From the explainer');
  const { prerequisites, intuition, walkthrough, analogy, equations } = explainer;

  return (
    <CiteProvider value={cite}>
      <div className={styles.body}>
        {prerequisites.length > 0 ? (
          <section className={styles.part} aria-labelledby="explain-first">
            <h2 id="explain-first">What you need to know first</h2>
            <dl className={styles.named} data-layout="grid">
              {prerequisites.map((p) => (
                <div key={p.concept}>
                  <dt>
                    {p.concept}
                    {p.shelfConcept ? (
                      <a className={styles.shelfLink} href={conceptHref(p.shelfConcept)} title={`On your shelf as “${p.shelfConcept}”`}>
                        on your shelf
                      </a>
                    ) : null}
                  </dt>
                  <dd>
                    <Spans spans={p.why} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {intuition.length > 0 ? (
          <section className={`${styles.part} ${styles.essay}`} aria-labelledby="explain-idea">
            <h2 id="explain-idea">The idea</h2>
            <Blocks blocks={intuition} {...cite} onMagnify={onMagnify} />
          </section>
        ) : null}

        {analogy ? (
          <aside className={styles.analogy} aria-label="An analogy">
            <p>
              <Spans spans={analogy} />
            </p>
          </aside>
        ) : null}

        {walkthrough.length > 0 ? (
          <section className={styles.part} aria-labelledby="explain-walk">
            <h2 id="explain-walk">Walkthrough</h2>
            <Blocks blocks={walkthrough} {...cite} onMagnify={onMagnify} />
          </section>
        ) : null}

        {equations.length > 0 ? (
          <section className={styles.part} aria-labelledby="explain-math">
            <h2 id="explain-math">Key equations, in plain words</h2>
            <Blocks blocks={equations} {...cite} />
          </section>
        ) : null}
        {overlays}
      </div>
    </CiteProvider>
  );
}

export default ExplainerBody;

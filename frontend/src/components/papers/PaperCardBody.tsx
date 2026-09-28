/**
 * The paper card tab (dissect-paper's `paper_card`) as one island: the tl;dr set as the
 * paper's lead, the question it asks, the numbers as the guide's stat tiles, then
 * contributions by kind, method, setup, results, and what to be wary of (limitations
 * the authors state beside the ones they do not, assumptions, future work). Server-
 * rendered like the rest of the page; hydrated so cites open their passage in place.
 */
import type { PreparedBlock } from '../../lib/prepare';
import type { Spans as SpansData } from '../../lib/contract';
import { Blocks } from '../blocks/Blocks';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import NumberTiles from '../guide/NumberTiles';
import type { PassageUnit } from '../guide/passage';
import { contributionsByKind, type Named, type PaperCard } from './bodies';
import { useCitedPassages } from './useCitedPassages';
import styles from './PaperViews.module.css';

export interface PaperCardBodyProps {
  slug: string;
  /** `method` and `results` passed through `prepareBlocks`. */
  card: PaperCard & { method: PreparedBlock[]; results: PreparedBlock[] };
  units: PassageUnit[];
}

function SpanList({ items, label }: { items: SpansData[]; label: string }) {
  return (
    <ul className={styles.list} aria-label={label}>
      {items.map((spans, i) => (
        <li key={i}>
          <Spans spans={spans} />
        </li>
      ))}
    </ul>
  );
}

function NamedList({ title, items }: { title: string; items: Named[] }) {
  return (
    <div className={styles.setupColumn}>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <dl className={styles.named}>
          {items.map((item) => (
            <div key={item.name}>
              <dt>{item.name}</dt>
              <dd>
                <Spans spans={item.spans} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className={styles.none}>None named.</p>
      )}
    </div>
  );
}

export function PaperCardBody({ slug, card, units }: PaperCardBodyProps) {
  const { cite, onMagnify, overlays } = useCitedPassages(slug, units, 'From the paper card');
  const groups = contributionsByKind(card);
  const { datasets, baselines, metrics } = card.setup;
  const hasSetup = datasets.length + baselines.length + metrics.length > 0;
  const { stated, unstated } = card.limitations;

  return (
    <CiteProvider value={cite}>
      <div className={styles.body}>
        {card.tldr.length > 0 || card.question.length > 0 ? (
          <section className={styles.lead} aria-label="In short">
            {card.tldr.length > 0 ? (
              <p className={styles.tldr}>
                <Spans spans={card.tldr} />
              </p>
            ) : null}
            {card.question.length > 0 ? (
              <div className={styles.question}>
                <h2>The question</h2>
                <p>
                  <Spans spans={card.question} />
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {card.numbers.length > 0 ? (
          <section className={styles.part} aria-labelledby="card-numbers">
            <h2 id="card-numbers">In numbers</h2>
            <NumberTiles tiles={card.numbers} {...cite} label="In numbers" />
          </section>
        ) : null}

        {groups.length > 0 ? (
          <section className={styles.part} aria-labelledby="card-contributions">
            <h2 id="card-contributions">What it contributes</h2>
            <dl className={styles.kinds}>
              {groups.map((group) => (
                <div key={group.kind} className={styles.kind} data-kind={group.kind}>
                  <dt>{group.label}</dt>
                  <dd>
                    <SpanList items={group.items} label={group.label} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        {card.method.length > 0 ? (
          <section className={styles.part} aria-labelledby="card-method">
            <h2 id="card-method">Method</h2>
            <Blocks blocks={card.method} {...cite} onMagnify={onMagnify} />
          </section>
        ) : null}

        {hasSetup ? (
          <section className={styles.part} aria-labelledby="card-setup">
            <h2 id="card-setup">Setup</h2>
            <div className={styles.setup}>
              <NamedList title="Datasets" items={datasets} />
              <NamedList title="Baselines" items={baselines} />
              <NamedList title="Metrics" items={metrics} />
            </div>
          </section>
        ) : null}

        {card.results.length > 0 ? (
          <section className={styles.part} aria-labelledby="card-results">
            <h2 id="card-results">Results</h2>
            <Blocks blocks={card.results} {...cite} onMagnify={onMagnify} />
          </section>
        ) : null}

        {stated.length + unstated.length > 0 ? (
          <section className={styles.part} aria-labelledby="card-limits">
            <h2 id="card-limits">Limitations</h2>
            <div className={styles.pair}>
              <div className={styles.side}>
                <h3>Stated by the authors</h3>
                {stated.length > 0 ? <SpanList items={stated} label="Stated by the authors" /> : <p className={styles.none}>The paper states none.</p>}
              </div>
              <div className={styles.side} data-tone="caution">
                <h3>Not stated in the paper</h3>
                {unstated.length > 0 ? <SpanList items={unstated} label="Not stated in the paper" /> : <p className={styles.none}>Nothing further found.</p>}
              </div>
            </div>
          </section>
        ) : null}

        {card.assumptions.length + card.futureWork.length > 0 ? (
          <section className={styles.part} aria-label="Assumptions and future work">
            <div className={styles.pair}>
              {card.assumptions.length > 0 ? (
                <div>
                  <h2 id="card-assumptions">What it assumes</h2>
                  <SpanList items={card.assumptions} label="What it assumes" />
                </div>
              ) : null}
              {card.futureWork.length > 0 ? (
                <div>
                  <h2 id="card-future">Where it could go next</h2>
                  <SpanList items={card.futureWork} label="Where it could go next" />
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
        {overlays}
      </div>
    </CiteProvider>
  );
}

export default PaperCardBody;

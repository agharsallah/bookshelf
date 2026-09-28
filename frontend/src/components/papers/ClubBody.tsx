/**
 * The journal club pack (make-journal-club) as a one-page handout: the pitch set large,
 * the key figure with why it matters (and a link to it in the paper), the weakest
 * assumption, five questions for the room in the order to ask them, and the debate —
 * for and against, facing each other. Prints on its own (see ClubTab's print styles).
 */
import { CiteProvider } from '../blocks/CiteContext';
import { SourceLink } from '../blocks/CiteChip';
import { Spans } from '../blocks/Spans';
import type { PassageUnit } from '../guide/passage';
import type { JournalClub } from './study-bodies';
import { useCitedPassages } from './useCitedPassages';
import styles from './Club.module.css';

export interface KeyFigureImage {
  src: string;
  alt: string;
  caption: string | null;
}

export interface ClubBodyProps {
  slug: string;
  club: JournalClub;
  /** The key figure's crop, when the parser extracted one. */
  figure: KeyFigureImage | null;
  units: PassageUnit[];
}

export function ClubBody({ slug, club, figure, units }: ClubBodyProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the journal club');
  const { keyFigure } = club;
  return (
    <CiteProvider value={cite}>
      <article className={styles.pack}>
        {club.pitch.length > 0 ? (
          <section className={styles.pitch} aria-label="The pitch">
            <p>
              <Spans spans={club.pitch} />
            </p>
          </section>
        ) : null}

        {keyFigure ? (
          <section className={styles.figure} aria-labelledby="club-figure">
            <h2 id="club-figure">Put this figure up</h2>
            <figure>
              {figure ? <img src={figure.src} alt={figure.alt} loading="lazy" /> : null}
              <figcaption>
                {figure?.caption ? <span className={styles.caption}>{figure.caption}</span> : null}
                <SourceLink anchor={keyFigure.anchor} className={styles.figureLink}>
                  {figure ? `Figure at ${cite.citeLabel(keyFigure.anchor)} in the paper` : `Open the figure at ${cite.citeLabel(keyFigure.anchor)}`}
                </SourceLink>
              </figcaption>
            </figure>
            <p className={styles.why}>
              <Spans spans={keyFigure.why} />
            </p>
          </section>
        ) : null}

        {club.weakestAssumption.length > 0 ? (
          <section className={styles.weakest} aria-labelledby="club-weakest">
            <h2 id="club-weakest">Its weakest assumption</h2>
            <p>
              <Spans spans={club.weakestAssumption} />
            </p>
          </section>
        ) : null}

        {club.questions.length > 0 ? (
          <section aria-labelledby="club-questions">
            <h2 id="club-questions">Questions for the room</h2>
            <ol className={styles.questions}>
              {club.questions.map((q, i) => (
                <li key={i}>
                  <span>
                    <Spans spans={q} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {club.debate.for.length + club.debate.against.length > 0 ? (
          <section aria-labelledby="club-debate">
            <h2 id="club-debate">The debate</h2>
            <div className={styles.debate}>
              <div data-side="for">
                <h3>For</h3>
                <ul>
                  {club.debate.for.map((s, i) => (
                    <li key={i}>
                      <Spans spans={s} />
                    </li>
                  ))}
                </ul>
              </div>
              <div data-side="against">
                <h3>Against</h3>
                <ul>
                  {club.debate.against.map((s, i) => (
                    <li key={i}>
                      <Spans spans={s} />
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}
        {overlays}
      </article>
    </CiteProvider>
  );
}

export default ClubBody;

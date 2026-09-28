/**
 * The book guide's sections as one island: server-rendered like the rest of the page,
 * hydrated so a cite opens its passage in place (PassagePanel) and drawn figures get
 * a Magnify button (the shared lightbox). A cite outside every chapter, and any
 * ⌘/Ctrl/middle click, still follows its link into the reader.
 */
import { navigate } from 'astro:transitions/client';
import { useCallback, useState } from 'react';
import type { Anchor } from '../../lib/contract';
import type { PreparedBlock } from '../../lib/prepare';
import { Blocks } from '../blocks/Blocks';
import { useFigureLightbox } from '../reader/useFigureLightbox';
import ChapterJourney from './ChapterJourney';
import NumberTiles from './NumberTiles';
import { PassagePanel, type PassageTarget } from './PassagePanel';
import ThemeHeatmap from './ThemeHeatmap';
import type { ChapterRow, GuideKey, GuideSection, KeyNumber, Theme } from './guide';
import { unitOfAnchor, type PassageUnit } from './passage';
import styles from './GuideBody.module.css';

export interface GuideBodyProps {
  slug: string;
  sections: (GuideSection & { blocks: PreparedBlock[] })[];
  rows: ChapterRow[];
  themes: Theme[];
  numbers: KeyNumber[];
  /** Every chapter a cite can land in, in reading order. */
  units: PassageUnit[];
}

export function GuideBody({ slug, sections, rows, themes, numbers, units }: GuideBodyProps) {
  const [passage, setPassage] = useState<PassageTarget | null>(null);
  const readHref = useCallback((anchor: Anchor) => `/documents/${slug}/read/${anchor}`, [slug]);
  const onCite = useCallback(
    (anchor: Anchor) => {
      const unit = unitOfAnchor(units, anchor);
      if (unit) setPassage({ unit, anchor });
      else void navigate(readHref(anchor));
    },
    [units, readHref],
  );
  const { openDrawing, lightbox } = useFigureLightbox([], onCite, 'From the book guide');
  const cite = { citeHref: readHref, onCite };
  const byKey = new Map<GuideKey, GuideSection & { blocks: PreparedBlock[] }>(sections.map((s) => [s.key, s]));
  const overview = byKey.get('overview');
  const map = byKey.get('map');
  const deep = byKey.get('deep_dive');
  const practice = byKey.get('practice');
  const ideas = (deep?.blocks ?? []).flatMap((b) => (b.type === 'heading' && b.level === 2 ? [b.text] : []));

  return (
    <div className={styles.body}>
      {overview ? (
        <section className={`${styles.part} ${styles.overview}`} id="guide-overview" aria-labelledby="guide-overview-h">
          <h2 id="guide-overview-h">{overview.title}</h2>
          <Blocks blocks={overview.blocks} {...cite} />
        </section>
      ) : null}

      {numbers.length > 0 ? (
        <section className={styles.part} id="guide-numbers" aria-labelledby="guide-numbers-h">
          <h2 id="guide-numbers-h">Numbers to remember</h2>
          <NumberTiles tiles={numbers} {...cite} label="Numbers to remember" />
        </section>
      ) : null}

      {map ? (
        <section className={styles.part} id="guide-map" aria-labelledby="guide-map-h">
          <h2 id="guide-map-h">{map.title}</h2>
          <Blocks blocks={map.blocks} {...cite} onMagnify={openDrawing} />
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section className={styles.part} id="guide-journey" aria-labelledby="guide-journey-h">
          <h2 id="guide-journey-h">Chapter by chapter</h2>
          <ChapterJourney rows={rows} {...cite} />
        </section>
      ) : null}

      {themes.length > 0 ? (
        <section className={styles.part} id="guide-themes" aria-labelledby="guide-themes-h">
          <h2 id="guide-themes-h">Ideas that run through the book</h2>
          <p className={styles.lede}>Where the author returns to each theme. Darker cells cite more passages; select one to read the first.</p>
          <ThemeHeatmap themes={themes} rows={rows} {...cite} />
        </section>
      ) : null}

      {deep ? (
        <section className={`${styles.part} ${styles.deep}`} id="guide-deep" aria-labelledby="guide-deep-h">
          <h2 id="guide-deep-h">{deep.title}</h2>
          {ideas.length > 1 ? (
            <ol className={styles.ideas} aria-label="Core ideas">
              {ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ol>
          ) : null}
          <Blocks blocks={deep.blocks} {...cite} onMagnify={openDrawing} className={styles.deepBlocks} />
        </section>
      ) : null}

      {practice ? (
        <section className={`${styles.part} ${styles.practice}`} id="guide-practice" aria-labelledby="guide-practice-h">
          <h2 id="guide-practice-h">{practice.title}</h2>
          <Blocks blocks={practice.blocks} {...cite} onMagnify={openDrawing} />
        </section>
      ) : null}

      {passage ? (
        <PassagePanel slug={slug} units={units} target={passage} onTarget={setPassage} onClose={() => setPassage(null)} readHref={readHref} />
      ) : null}
      {lightbox}
    </div>
  );
}

export default GuideBody;

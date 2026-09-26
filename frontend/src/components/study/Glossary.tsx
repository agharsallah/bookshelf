/**
 * The glossary (island): every term, filed A–Z, each defined with the definition block
 * the rest of the site uses. The letter index jumps to a letter (letters with no term,
 * or none left after filtering, are shown but disabled); the filter narrows as you type.
 */
import { useMemo, useState } from 'react';
import type { DefinitionBlock } from '../../lib/contract';
import { Blocks } from '../blocks/Blocks';
import { ALPHABET, byLetter, matches } from './listing';
import { readerHref } from './ReaderCites';
import { plainText } from './study-body';
import styles from './Glossary.module.css';
import shared from './Study.module.css';

export interface GlossaryProps {
  slug: string;
  terms: DefinitionBlock[];
}

const letterId = (letter: string) => `glossary-${letter === '#' ? 'other' : letter.toLowerCase()}`;

export function Glossary({ slug, terms }: GlossaryProps) {
  const [query, setQuery] = useState('');
  const citeHref = useMemo(() => readerHref(slug), [slug]);
  const shown = terms.filter((t) => matches(query, `${t.term} ${plainText(t.spans)}`));
  const sections = byLetter(shown, (t) => t.term);
  const present = new Set(sections.map((s) => s.letter));

  return (
    <section className={styles.glossary} aria-label="Glossary">
      <div className={styles.head}>
        <div className={shared.toolbar}>
          <label className={shared.search}>
            <span className="visually-hidden">Filter the terms</span>
            <input type="search" placeholder="Filter the terms" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <span className={shared.count} aria-live="polite">
            {query ? `${shown.length} of ${terms.length} terms` : `${terms.length} terms`}
          </span>
        </div>
        <nav aria-label="Jump to a letter">
          <ol className={styles.letters}>
            {ALPHABET.map((letter) => (
              <li key={letter}>
                {present.has(letter) ? (
                  <a href={`#${letterId(letter)}`}>{letter}</a>
                ) : (
                  <span aria-disabled="true" title={`No terms under ${letter}`}>
                    {letter}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {sections.length === 0 ? (
        <p className={shared.none}>
          No term matches “{query}”.{' '}
          <button type="button" className="btn btn-quiet" onClick={() => setQuery('')}>
            Clear the filter
          </button>
        </p>
      ) : (
        <div className={styles.sheet}>
          {sections.map((section) => (
            <section key={section.letter} className={styles.section} aria-labelledby={letterId(section.letter)}>
              <h2 id={letterId(section.letter)} className={styles.letter} tabIndex={-1}>
                {section.letter}
              </h2>
              <Blocks blocks={section.items} citeHref={citeHref} className={styles.terms} />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

export default Glossary;

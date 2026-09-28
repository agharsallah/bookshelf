/**
 * The notation table as a side panel over the reader (passes 2 and 3): the paper tabs'
 * `NotationTable` in its compact form, its "first used" links jumping in the text.
 */
import { CiteProvider } from '../../blocks/CiteContext';
import { mathHref } from '../../papers/math-explainer';
import { NotationTable } from '../../papers/NotationTable';
import type { PaperNotation } from './types';
import styles from './Paper.module.css';

export interface NotationPanelProps {
  /** The paper's slug, for the "Explain this math" links to its math tab. */
  slug: string;
  notation: PaperNotation;
  onCite: (anchor: string) => void;
  citeHref: (anchor: string) => string;
  onClose: () => void;
}

export function NotationPanel({ slug, notation, onCite, citeHref, onClose }: NotationPanelProps) {
  return (
    <aside className={styles.notation} aria-labelledby="notation-title">
      <header className={styles.notationHead}>
        <h2 id="notation-title">Notation</h2>
        {notation.standing === 'draft' ? <span className={styles.draft}>Draft, not reviewed</span> : null}
        <button type="button" className={styles.close} aria-label="Close the notation" onClick={onClose}>
          ×
        </button>
      </header>
      <a className={styles.explainMath} href={mathHref(slug)}>
        Explain this math
      </a>
      {notation.symbols.length === 0 ? (
        <p className={styles.quiet}>The notation table lists no symbols.</p>
      ) : (
        <CiteProvider value={{ onCite, citeHref }}>
          <NotationTable symbols={notation.symbols} compact searchable={notation.symbols.length > 8} explainHref={(formula) => mathHref(slug, formula)} />
        </CiteProvider>
      )}
    </aside>
  );
}

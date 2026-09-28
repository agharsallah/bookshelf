/** The notation tab's island: the table, with first uses and cites opening in place. */
import { CiteProvider } from '../blocks/CiteContext';
import type { PassageUnit } from '../guide/passage';
import { mathHref } from './math-explainer';
import type { PreparedSymbol } from './notation';
import { NotationTable } from './NotationTable';
import styles from './Notation.module.css';
import { useCitedPassages } from './useCitedPassages';

export interface NotationBodyProps {
  slug: string;
  symbols: PreparedSymbol[];
  units: PassageUnit[];
}

export function NotationBody({ slug, symbols, units }: NotationBodyProps) {
  const { cite, overlays } = useCitedPassages(slug, units, 'From the notation');
  return (
    <CiteProvider value={cite}>
      <p className={styles.explainAll}>
        <a href={mathHref(slug)}>Explain this math</a>, formula by formula, for someone with no maths background.
      </p>
      <NotationTable symbols={symbols} searchable={symbols.length > 4} explainHref={(formula) => mathHref(slug, formula)} />
      {overlays}
    </CiteProvider>
  );
}

export default NotationBody;

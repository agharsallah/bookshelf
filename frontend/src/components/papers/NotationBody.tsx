/** The notation tab's island: the table, with first uses and cites opening in place. */
import { CiteProvider } from '../blocks/CiteContext';
import type { PassageUnit } from '../guide/passage';
import type { PreparedSymbol } from './notation';
import { NotationTable } from './NotationTable';
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
      <NotationTable symbols={symbols} searchable={symbols.length > 4} />
      {overlays}
    </CiteProvider>
  );
}

export default NotationBody;

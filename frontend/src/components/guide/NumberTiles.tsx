/**
 * Stat tiles: a large value over a short, cited label. Used for the numbers the book
 * wants remembered, and (without cites) for the guide's at-a-glance row.
 */
import { defaultCiteHref } from '../../lib/anchors';
import type { Anchor, Span } from '../../lib/contract';
import { CiteProvider } from '../blocks/CiteContext';
import { Spans } from '../blocks/Spans';
import styles from './Guide.module.css';

/** Characters past which a value steps down a size to stay inside its tile. */
const LONG_VALUE = 7;

export interface Tile {
  value: string;
  label: Span[] | string;
}

export interface NumberTilesProps {
  tiles: readonly Tile[];
  citeHref?: (anchor: Anchor) => string;
  /** Open a passage in place instead of following the link (plain clicks only). */
  onCite?: ((anchor: Anchor) => void) | undefined;
  /** `quiet` for the header's facts: smaller, no frame. */
  variant?: 'framed' | 'quiet';
  label: string;
}

export function NumberTiles({ tiles, citeHref = defaultCiteHref, variant = 'framed', label, onCite }: NumberTilesProps) {
  return (
    <CiteProvider value={{ citeHref, onCite }}>
      <ul className={styles.tiles} data-variant={variant} aria-label={label}>
        {tiles.map((tile, i) => (
          <li key={i} className={styles.tile}>
            <span className={styles.value} data-long={tile.value.length > LONG_VALUE ? '' : undefined}>
              {tile.value}
            </span>
            <span className={styles.tileLabel}>{typeof tile.label === 'string' ? tile.label : <Spans spans={tile.label} />}</span>
          </li>
        ))}
      </ul>
    </CiteProvider>
  );
}

export default NumberTiles;

/** A row of headline figures: the few numbers a page is about, each with a short note. */
import styles from './Stats.module.css';

export interface Tile {
  label: string;
  value: string;
  note?: string;
}

export function StatTiles({ tiles, label }: { tiles: readonly Tile[]; label: string }) {
  return (
    <dl className={styles.tiles} aria-label={label}>
      {tiles.map((tile) => (
        <div key={tile.label} className={styles.tile}>
          <dt>{tile.label}</dt>
          <dd>
            <span className={styles.tileValue}>{tile.value}</span>
            {tile.note ? <span className={styles.tileNote}>{tile.note}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The key to the canvas: node kinds by shape and colour, relations by line and mark.
 * The swatches are small inline SVGs drawn from the same style table as the canvas.
 */
import { ENTITY_KINDS, RELATIONS, type EntityKind, type Relation } from '../../lib/api/types/graph';
import { KIND_STYLES, PROPOSED_DASH, RELATION_STYLES } from './styles';
import styles from './Graph.module.css';

export function KindMark({ kind }: { kind: EntityKind }) {
  const style = KIND_STYLES[kind];
  const color = `var(${style.color})`;
  return (
    <svg className={styles.mark} viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      {style.shape === 'ring' ? <circle cx="7" cy="7" r="5" fill="var(--paper)" stroke={color} strokeWidth="2" /> : null}
      {style.shape === 'square' ? <rect x="3" y="3" width="8" height="8" fill={color} /> : null}
      {style.shape === 'spine' ? <rect x="4.5" y="1" width="5" height="12" rx="1" fill={color} /> : null}
      {style.shape === 'diamond' ? <path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill="var(--paper)" stroke={color} strokeWidth="1.8" /> : null}
    </svg>
  );
}

export function RelationMark({ relation, proposed = false }: { relation: Relation; proposed?: boolean }) {
  const style = RELATION_STYLES[relation];
  const color = `var(${style.color})`;
  const dash = (proposed ? PROPOSED_DASH : style.dash).join(' ') || undefined;
  return (
    <svg className={styles.mark} viewBox="0 0 30 12" width="30" height="12" aria-hidden="true">
      <path d="M1 8 Q15 2 27 6" fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={dash} strokeLinecap="round" />
      {style.terminal === 'arrow' ? <path d="M22.5 3 27 6 22.8 9" fill="none" stroke={color} strokeWidth="1.4" /> : null}
      {style.terminal === 'bar' ? <path d="M27.5 1.5V10.5" stroke={color} strokeWidth="1.6" /> : null}
      {style.terminal === 'dot' ? <circle cx="26" cy="6" r="2" fill={color} /> : null}
      {style.terminal === 'tick' ? <circle cx="25.5" cy="6" r="2.4" fill="none" stroke={color} strokeWidth="1.3" /> : null}
      {style.terminal === 'equals' ? <path d="M13 1.8V8.8M16.5 1.4V8.4" stroke={color} strokeWidth="1.3" /> : null}
    </svg>
  );
}

export function Legend() {
  return (
    <div className={styles.legend} aria-label="Key">
      <ul>
        {ENTITY_KINDS.map((k) => (
          <li key={k}>
            <KindMark kind={k} />
            {KIND_STYLES[k].plural}
          </li>
        ))}
      </ul>
      <ul>
        {RELATIONS.map((r) => (
          <li key={r}>
            <RelationMark relation={r} />
            {RELATION_STYLES[r].label}
          </li>
        ))}
        <li>
          <RelationMark relation="same_as" proposed />
          Proposed (any relation)
        </li>
      </ul>
    </div>
  );
}

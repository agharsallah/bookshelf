/**
 * Synthesis results open with where the books meet: accepted relations between concepts
 * found in the result documents ("Reinforcing loop contradicts Balancing loop"),
 * contradictions first, each with its passages linking into the reader.
 */
import { anchorLabel } from '../../lib/anchors';
import type { ConceptRelation, SearchGroup } from '../../lib/api/types/search';
import { RelationMark } from '../graph/Legend';
import { RELATION_STYLES } from '../graph/styles';
import { splitCite } from './cites';
import { conceptHref, readerHref } from './links';
import styles from './Search.module.css';

export function RelationsNote({ relations, groups }: { relations: readonly ConceptRelation[]; groups: readonly SearchGroup[] }) {
  if (relations.length === 0) return null;
  const titles = new Map(groups.map((g) => [g.document.slug, g.document.title]));
  return (
    <section className={styles.relations} aria-labelledby="relations-title">
      <h2 id="relations-title" className={styles.relationsHead}>
        Where the books meet
      </h2>
      <ul>
        {relations.map((r) => (
          <li key={`${r.src.id}-${r.relation}-${r.dst.id}`}>
            <RelationMark relation={r.relation} />
            <span className={styles.relationClaim}>
              <a href={conceptHref(r.src.id)}>{r.src.canonical}</a> <em>{RELATION_STYLES[r.relation].verb}</em>{' '}
              <a href={conceptHref(r.dst.id)}>{r.dst.canonical}</a>
            </span>
            <span className={styles.relationCites}>
              {r.evidence.map((cite) => {
                const { slug, anchor } = splitCite(cite);
                return slug ? (
                  <a key={cite} href={readerHref(slug, anchor)} title={titles.get(slug) ?? slug}>
                    {anchorLabel(anchor)}
                  </a>
                ) : null;
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

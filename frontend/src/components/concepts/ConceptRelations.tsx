/**
 * A concept's relations, grouped by kind of relation, strongest first. Each entry reads
 * as a sentence ("extends Feedback loop", "Delay is an example of this") and carries
 * its evidence passages across books, each linking into the reader. Static: renders in
 * the .astro page without hydration.
 */
import type { ConceptEdge, GraphNode, RelationGroup } from '../../lib/api/types/graph';
import { RelationMark } from '../graph/Legend';
import { parseRef } from '../graph/refs';
import { RELATION_STYLES } from '../graph/styles';
import { conceptHref, documentHref, readerHref } from '../search/links';
import { PassageList } from './PassageList';
import styles from './ConceptPage.module.css';

function hrefOf(node: GraphNode): string | null {
  const parsed = parseRef(node.id);
  if (node.kind === 'concept' && parsed) return conceptHref(parsed.id);
  if (node.kind === 'document' && node.document) return documentHref(node.document.slug);
  if (node.document) return readerHref(node.document.slug, node.anchor);
  return null;
}

function Other({ node }: { node: GraphNode }) {
  const href = hrefOf(node);
  const label = node.kind === 'node' ? `“${node.label}”` : node.label;
  return href ? (
    <a className={styles.other} href={href}>
      {label}
    </a>
  ) : (
    <span className={styles.other}>{label}</span>
  );
}

function Entry({ edge }: { edge: ConceptEdge }) {
  const verb = RELATION_STYLES[edge.relation].verb;
  const books = new Set(edge.evidence.map((p) => p.document?.id).filter(Boolean));
  return (
    <li className={styles.entry} data-status={edge.status}>
      <p className={styles.claim}>
        {edge.direction === 'out' ? (
          <>
            <span className={styles.verb}>{verb}</span> <Other node={edge.other} />
          </>
        ) : (
          <>
            <Other node={edge.other} /> <span className={styles.verb}>{verb} this</span>
          </>
        )}
        {edge.status === 'proposed' ? <span className={styles.proposed}>proposed</span> : null}
      </p>
      {edge.evidence.length ? (
        <details className={styles.evidence}>
          <summary>
            {edge.evidence.length === 1 ? '1 passage' : `${edge.evidence.length} passages`}
            {books.size > 1 ? ` in ${books.size} books` : ''}
          </summary>
          <PassageList passages={edge.evidence} />
        </details>
      ) : null}
    </li>
  );
}

export function ConceptRelations({ groups }: { groups: readonly RelationGroup[] }) {
  return (
    <div className={styles.relations}>
      {groups.map((group) => (
        <section key={group.relation} className={styles.group} aria-labelledby={`rel-${group.relation}`}>
          <h2 id={`rel-${group.relation}`} className={styles.groupHead}>
            <RelationMark relation={group.relation} />
            {RELATION_STYLES[group.relation].label}
            <span className={styles.groupCount}>{group.edges.length}</span>
          </h2>
          <ul className={styles.entries}>
            {group.edges.map((edge) => (
              <Entry key={edge.id} edge={edge} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

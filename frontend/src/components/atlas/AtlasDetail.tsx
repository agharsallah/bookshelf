/**
 * The margin beside the map: whatever is selected, and the way back to the content.
 *
 * - a **concept**: its gloss, how far it reaches, every chapter it appears in (each opens
 *   the reader there), its related ideas, and links to its page and its neighbourhood;
 * - a **chapter**: "Read this chapter", the ideas it discusses, and the chapters that
 *   share them — the links between sections, each readable in one click;
 * - a **book**: its chapters and the ideas it leans on most;
 * - a **line**: a stored relation shows its evidence passages (`EdgeEvidence`); a
 *   "shares" line shows what the two chapters have in common.
 *
 * Buttons move the selection across the map (it glides there); links leave for the page.
 */
import type { ReactNode } from 'react';
import type { ApiClient } from '../../lib/api/client';
import { GENRE_LABELS } from '../../lib/api/types/documents';
import type { AtlasEdge, AtlasNode } from '../../lib/api/types/graph';
import { conceptHref, documentHref, readerHref } from '../search/links';
import { EdgeEvidence } from '../graph/EdgeEvidence';
import { KindMark, RelationMark } from '../graph/Legend';
import type { ModelEdge } from '../graph/model';
import { graphHref, parseRef } from '../graph/refs';
import { CONCEPT_KIND_STYLES, LINK_STYLES } from '../graph/styles';
import { appearances, bookIdeas, chaptersOf, echoesOf, relatedIdeas, sharedWith, type Appearance } from './connections';
import type { AtlasIndex } from './model';
import graph from '../graph/Graph.module.css';
import styles from './Atlas.module.css';

export interface AtlasDetailProps {
  api: ApiClient;
  index: AtlasIndex;
  node: AtlasNode | null;
  edge: ModelEdge<AtlasEdge> | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Start tracing a path from this node. */
  onPathFrom?: (id: string) => void;
}

const LIST_MAX = 12;

function readHref(node: AtlasNode): string | null {
  if (!node.document) return null;
  return node.kind === 'chapter' ? readerHref(node.document.slug, node.anchor) : documentHref(node.document.slug);
}

function Pick({ node, onSelect, note }: { node: AtlasNode; onSelect: (id: string) => void; note?: string }) {
  return (
    <button type="button" className={styles.pick} onClick={() => onSelect(node.id)}>
      <span className={node.kind === 'concept' ? styles.pickConcept : undefined}>{node.label}</span>
      {note ? <span className={styles.pickNote}>{note}</span> : null}
    </button>
  );
}

function ChapterRow({ link, onSelect }: { link: Appearance; onSelect: (id: string) => void }) {
  const href = readHref(link.node);
  const how = link.relations.map((r) => LINK_STYLES[r].label.toLowerCase()).join(', ');
  const passages = link.passages ? ` · ${link.passages} ${link.passages === 1 ? 'passage' : 'passages'}` : '';
  return (
    <li className={styles.row}>
      <Pick node={link.node} onSelect={onSelect} note={`${how}${passages}`} />
      {href ? (
        <a className={styles.read} href={href} aria-label={`Read ${link.node.label}`}>
          Read
        </a>
      ) : null}
    </li>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section className={styles.detailSection}>
      <h3>
        {title} <span className={styles.detailCount}>{count}</span>
      </h3>
      {children}
    </section>
  );
}

function More({ total }: { total: number }) {
  return total > LIST_MAX ? <p className={graph.panelMeta}>And {total - LIST_MAX} more.</p> : null;
}

function ConceptDetail({ index, node, onSelect }: { index: AtlasIndex; node: AtlasNode; onSelect: (id: string) => void }) {
  const where = appearances(index, node.id);
  const related = relatedIdeas(index, node.id);
  const parsed = parseRef(node.id);
  return (
    <>
      <p className={graph.panelMeta}>
        {node.books > 1 ? `In ${node.books} books` : node.books === 1 ? 'In one book' : 'Not tied to a passage yet'}
        {node.passages ? `, ${node.passages} ${node.passages === 1 ? 'passage' : 'passages'}` : ''}
      </p>
      {node.blurb ? <p className={graph.panelBlurb}>{node.blurb}</p> : null}
      <div className={graph.panelActions}>
        {parsed ? (
          <a className={graph.actionLink} href={conceptHref(parsed.id)}>
            Open the concept page
          </a>
        ) : null}
        <a className={graph.actionLink} href={graphHref(node.id)}>
          Explore its neighbourhood
        </a>
      </div>
      <Section title="Where it appears" count={where.length}>
        <ul className={styles.rows}>
          {where.slice(0, LIST_MAX).map((l) => (
            <ChapterRow key={l.edge.id} link={l} onSelect={onSelect} />
          ))}
        </ul>
        <More total={where.length} />
      </Section>
      <Section title="Related ideas" count={related.length}>
        <ul className={styles.rows}>
          {related.slice(0, LIST_MAX).map((l) => (
            <li key={l.edge.id} className={styles.row}>
              <RelationMark relation={l.relation} proposed={l.edge.status === 'proposed'} />
              <Pick
                node={l.node}
                onSelect={onSelect}
                note={l.outgoing ? LINK_STYLES[l.relation].verb : `is ${LINK_STYLES[l.relation].label.toLowerCase()} by`}
              />
            </li>
          ))}
        </ul>
        <More total={related.length} />
      </Section>
    </>
  );
}

function ChapterDetail({ index, node, onSelect }: { index: AtlasIndex; node: AtlasNode; onSelect: (id: string) => void }) {
  const ideas = relatedIdeas(index, node.id);
  const shared = sharedWith(index, node.id);
  const echoes = echoesOf(index, node.id);
  const href = readHref(node);
  const book = node.document ? index.byId.get(`document:${node.document.id}`) : undefined;
  return (
    <>
      {book ? (
        <p className={graph.panelMeta}>
          In <Pick node={book} onSelect={onSelect} />
        </p>
      ) : null}
      <div className={graph.panelActions}>
        {href ? (
          <a className={graph.action} href={href}>
            Read this chapter
          </a>
        ) : null}
        <a className={graph.actionLink} href={graphHref(node.id)}>
          Explore its neighbourhood
        </a>
      </div>
      <Section title="Ideas it discusses" count={ideas.length}>
        <ul className={styles.chips}>
          {ideas.slice(0, LIST_MAX * 2).map((l) => (
            <li key={l.edge.id}>
              <Pick node={l.node} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Chapters that echo it" count={echoes.length}>
        <ul className={styles.rows}>
          {echoes.map((e) => (
            <li key={e.edge.id} className={styles.row}>
              <Pick
                node={e.chapter}
                onSelect={onSelect}
                note={e.chapter.document?.id === node.document?.id ? `${e.edge.evidence_count} passages` : (e.chapter.sublabel ?? undefined)}
              />
              {e.chapter.document ? (
                <a
                  className={styles.read}
                  href={readerHref(e.chapter.document.slug, e.passage ?? e.chapter.anchor)}
                  aria-label={`Read the echo in ${e.chapter.label}`}
                >
                  Read the echo
                </a>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Chapters that share its ideas" count={shared.length}>
        <ul className={styles.rows}>
          {shared.map((s) => (
            <li key={s.edge.id} className={styles.shared}>
              <div className={styles.row}>
                <Pick
                  node={s.chapter}
                  onSelect={onSelect}
                  note={s.chapter.document?.id === node.document?.id ? undefined : (s.chapter.sublabel ?? undefined)}
                />
                {readHref(s.chapter) ? (
                  <a className={styles.read} href={readHref(s.chapter) ?? undefined} aria-label={`Read ${s.chapter.label}`}>
                    Read
                  </a>
                ) : null}
              </div>
              <p className={styles.via}>via {s.concepts.map((c) => c.label).join(', ')}</p>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function BookDetail({ index, node, onSelect }: { index: AtlasIndex; node: AtlasNode; onSelect: (id: string) => void }) {
  const chapters = chaptersOf(index, node.id);
  const ideas = bookIdeas(index, node.id);
  const href = readHref(node);
  return (
    <>
      {node.sublabel ? <p className={graph.panelMeta}>{node.sublabel}</p> : null}
      <div className={graph.panelActions}>
        {href ? (
          <a className={graph.action} href={href}>
            Open the book
          </a>
        ) : null}
      </div>
      {chapters.length === 0 ? <p className={graph.panelMeta}>None of its chapters is linked to an idea yet.</p> : null}
      <Section title="Ideas it leans on" count={ideas.length}>
        <ul className={styles.chips}>
          {ideas.map((c) => (
            <li key={c.id}>
              <Pick node={c} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Linked chapters" count={chapters.length}>
        <ul className={styles.rows}>
          {chapters.map((l) => (
            <li key={l.edge.id} className={styles.row}>
              <Pick node={l.node} onSelect={onSelect} note={`${l.node.degree - 1} links`} />
              <a className={styles.read} href={readHref(l.node) ?? undefined} aria-label={`Read ${l.node.label}`}>
                Read
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

function SharesDetail({ index, edge, onSelect }: { index: AtlasIndex; edge: AtlasEdge; onSelect: (id: string) => void }) {
  const [a, b] = [index.byId.get(edge.src), index.byId.get(edge.dst)];
  const concepts = edge.concepts.map((c) => index.byId.get(c)).filter((c): c is AtlasNode => c !== undefined);
  return (
    <div className={graph.panelBody}>
      <p className={graph.panelKind}>
        <RelationMark relation="shares" />
        Shares ideas
      </p>
      <h2 className={graph.panelTitle}>
        {a?.label} <em className={graph.verb}>and</em> {b?.label}
      </h2>
      <p className={graph.panelMeta}>
        {concepts.length === 1 ? 'One idea' : `${concepts.length} ideas`} in common
        {a?.document?.id !== b?.document?.id ? ', across books' : ''}.
      </p>
      <ul className={styles.chips}>
        {concepts.map((c) => (
          <li key={c.id}>
            <Pick node={c} onSelect={onSelect} />
          </li>
        ))}
      </ul>
      <ul className={styles.rows}>
        {[a, b].map((chapter) =>
          chapter ? (
            <li key={chapter.id} className={styles.row}>
              <Pick node={chapter} onSelect={onSelect} note={chapter.sublabel ?? undefined} />
              <a className={styles.read} href={readHref(chapter) ?? undefined} aria-label={`Read ${chapter.label}`}>
                Read
              </a>
            </li>
          ) : null,
        )}
      </ul>
    </div>
  );
}

export function AtlasDetail({ api, index, node, edge, onSelect, onChanged, onPathFrom }: AtlasDetailProps) {
  if (edge) {
    if (edge.relation === 'shares') return <SharesDetail index={index} edge={edge.data} onSelect={onSelect} />;
    if (edge.relation === 'contains') {
      const chapter = index.byId.get(edge.target);
      return chapter ? <AtlasDetail api={api} index={index} node={chapter} edge={null} onSelect={onSelect} onChanged={onChanged} /> : null;
    }
    return <EdgeEvidence api={api} edge={edge} onChanged={onChanged} />;
  }
  if (!node) return null;
  const kindLabel =
    node.kind === 'chapter'
      ? 'Chapter'
      : node.kind === 'document'
        ? GENRE_LABELS[node.genre ?? 'book']
        : CONCEPT_KIND_STYLES[node.concept_kind ?? 'concept'].label;
  return (
    <div className={graph.panelBody}>
      <p className={graph.panelKind}>
        <KindMark kind={node.kind === 'chapter' ? 'node' : node.kind} conceptKind={node.concept_kind} />
        {kindLabel}
        {node.kind === 'chapter' && node.sublabel ? <span className={graph.panelPlace}>{node.sublabel}</span> : null}
      </p>
      <h2 className={`${graph.panelTitle} ${node.kind === 'concept' ? styles.italic : ''}`}>{node.label}</h2>
      {node.kind === 'concept' ? <ConceptDetail index={index} node={node} onSelect={onSelect} /> : null}
      {node.kind === 'chapter' ? <ChapterDetail index={index} node={node} onSelect={onSelect} /> : null}
      {node.kind === 'document' ? <BookDetail index={index} node={node} onSelect={onSelect} /> : null}
      {onPathFrom ? (
        <button type="button" className={`${graph.actionQuiet} ${styles.pathButton}`} onClick={() => onPathFrom(node.id)}>
          Find a path from here
        </button>
      ) : null}
      <p className={styles.hint}>Double-click a mark on the map to open it: a chapter in the reader, a concept on its page.</p>
    </div>
  );
}

/**
 * Search results, grouped by document. Each book shows what you already know about the
 * query (distillation hits) apart from the evidence (source passages); lexical hits
 * carry their matched words highlighted. An addressed query leads with the chapter it
 * resolved to and that chapter's approved artifacts. The book speaks in the serif (titles,
 * distillations on a sheet, quoted passages); labels and counts are the tool's sans.
 */
import type { MouseEvent } from 'react';
import { Blocks } from '../blocks';
import { TYPE_LABELS } from '../review/labels';
import { anchorLabel } from '../../lib/anchors';
import type { RenderBlock } from '../../lib/contract';
import type { Intent } from '../../lib/api/types/search';
import { readerHref } from './links';
import { highlightSegments, type GroupView, type HitView, type ResultsView } from './results';
import styles from './Search.module.css';

export interface ResultsProps {
  view: ResultsView;
  intent: Intent;
  onOpen: (hit: HitView, event: MouseEvent<HTMLAnchorElement>) => void;
}

function excerptBlocks(hit: HitView): RenderBlock[] {
  if (hit.hit.blocks?.length) return hit.hit.blocks;
  return [{ type: 'paragraph', spans: [{ text: hit.hit.snippet, cites: [] }] }];
}

function Known({ hit, slug, onOpen }: { hit: HitView; slug: string; onOpen: ResultsProps['onOpen'] }) {
  const type = hit.hit.type ? TYPE_LABELS[hit.hit.type] : 'Distillation';
  return (
    <li className={styles.known}>
      <a className={styles.hitTitle} href={hit.href} data-hit={hit.key} onClick={(e) => onOpen(hit, e)}>
        <span className={styles.hitType}>{type}</span>
        {hit.hit.heading ? <span className={styles.hitHeading}>{hit.hit.heading}</span> : null}
      </a>
      <div className={styles.excerpt}>
        <Blocks blocks={excerptBlocks(hit)} citeHref={(a) => readerHref(slug, a)} />
      </div>
    </li>
  );
}

function Evidence({ hit, onOpen }: { hit: HitView; onOpen: ResultsProps['onOpen'] }) {
  const segments = highlightSegments(hit.hit.snippet, hit.hit.highlights);
  return (
    <li className={styles.evidence}>
      <span className={styles.gutter} aria-hidden="true">
        {hit.hit.anchor ? anchorLabel(hit.hit.anchor) : ''}
      </span>
      <a className={styles.passage} href={hit.href} data-hit={hit.key} onClick={(e) => onOpen(hit, e)}>
        {hit.hit.heading ? <span className={styles.passageHeading}>{hit.hit.heading}</span> : null}
        <span className={styles.snippet}>
          {segments.map((s, i) => (s.marked ? <mark key={i}>{s.text}</mark> : <span key={i}>{s.text}</span>))}
        </span>
      </a>
    </li>
  );
}

function Group({ group, onOpen }: { group: GroupView; onOpen: ResultsProps['onOpen'] }) {
  const { document } = group;
  return (
    <article className={styles.group} aria-labelledby={`doc-${document.id}`}>
      <header className={styles.groupHead}>
        <h2 id={`doc-${document.id}`} className="book-title">
          <a href={readerHref(document.slug)}>{document.title}</a>
        </h2>
        {document.authors.length ? <p className={styles.authors}>{document.authors.join(', ')}</p> : null}
      </header>
      {group.known.length ? (
        <section className={`${styles.tier} ${styles.knownTier}`} aria-label={`What you know from ${document.title}`}>
          <h3 className={styles.tierHead}>What you know</h3>
          <ul className={styles.hits}>
            {group.known.map((hit) => (
              <Known key={hit.key} hit={hit} slug={document.slug} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ) : null}
      {group.evidence.length ? (
        <section className={styles.tier} aria-label={`Evidence in ${document.title}`}>
          <h3 className={styles.tierHead}>In the text</h3>
          <ul className={styles.hits}>
            {group.evidence.map((hit) => (
              <Evidence key={hit.key} hit={hit} onOpen={onOpen} />
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function Resolved({ view, onOpen }: { view: ResultsView; onOpen: ResultsProps['onOpen'] }) {
  const resolved = view.resolved;
  if (!resolved) return null;
  const artifacts = view.groups[0]?.known ?? [];
  const lead = view.order[0];
  return (
    <article className={styles.resolved} aria-labelledby="resolved-title">
      <p className={`book-title ${styles.resolvedBook}`}>{resolved.document.title}</p>
      <h2 id="resolved-title" className={`book-title ${styles.resolvedTitle}`}>
        {resolved.heading ?? (resolved.anchor ? anchorLabel(resolved.anchor) : 'The whole book')}
      </h2>
      <a
        className={styles.open}
        href={resolved.href}
        data-hit={lead?.key ?? 'resolved'}
        onClick={(e) => lead && onOpen(lead, e)}
      >
        Open in the reader
      </a>
      {artifacts.length ? (
        <ul className={styles.hits}>
          {artifacts.map((hit) => (
            <Known key={hit.key} hit={hit} slug={resolved.document.slug} onOpen={onOpen} />
          ))}
        </ul>
      ) : (
        <p className={styles.quiet}>Nothing approved for this chapter yet. The reader has the source.</p>
      )}
    </article>
  );
}

export function Results({ view, intent, onOpen }: ResultsProps) {
  if (intent === 'addressed' && view.resolved) return <Resolved view={view} onOpen={onOpen} />;
  return (
    <div className={styles.groups}>
      {view.groups.map((group) => (
        <Group key={group.document.id} group={group} onOpen={onOpen} />
      ))}
    </div>
  );
}

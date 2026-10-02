/**
 * Reading inside a collection (`?collection=<slug>` on the reader): a thin trail above the
 * text naming the collection and where this document sits in it, with the documents before
 * and after; and, at the end of the last chapter, the next document in place of "Back to
 * the document". Following that link marks the document finished, so the collection's
 * "up next" moves on. Without a collection the reader shows neither.
 */
import { browserApi, type ApiClient } from '../../lib/api/client';
import { markFinished } from '../../lib/documents/finished';
import type { CollectionContext } from '../collections/load';
import { placeIn, readHref } from '../collections/path';
import styles from './CollectionTrail.module.css';

/** The collection read in; the document being read is one of its members. */
export type ReaderCollection = CollectionContext;

export interface CollectionTrailProps {
  collection: ReaderCollection;
  documentId: string;
}

export function CollectionTrail({ collection, documentId }: CollectionTrailProps) {
  const place = placeIn(collection.members, documentId);
  if (!place) return null;
  return (
    <nav className={styles.trail} aria-label={`In the collection ${collection.name}`}>
      <a className={styles.name} href={`/collections/${collection.slug}`}>
        {collection.name}
      </a>
      <span className={styles.place}>
        {place.index + 1} of {place.total}
      </span>
      {place.prev ? (
        <a href={readHref(place.prev.slug, collection.slug)} title={place.prev.title}>
          <span aria-hidden="true">‹ </span>
          <span className="visually-hidden">Previous in the collection: </span>
          {place.prev.title}
        </a>
      ) : null}
      {place.next ? (
        <a href={readHref(place.next.slug, collection.slug)} title={place.next.title}>
          <span className="visually-hidden">Next in the collection: </span>
          {place.next.title}
          <span aria-hidden="true"> ›</span>
        </a>
      ) : null}
    </nav>
  );
}

export interface NextInCollectionProps extends CollectionTrailProps {
  api?: Pick<ApiClient, 'put' | 'delete'>;
}

/** The end-of-document link: the next member to read, or back to the collection. Either marks this one finished. */
export function NextInCollection({ collection, documentId, api = browserApi }: NextInCollectionProps) {
  const place = placeIn(collection.members, documentId);
  if (!place) return null;
  // Sent as the page goes; a failed mark just leaves the progress the positions give.
  const finish = () => void markFinished(api, documentId, true, { keepalive: true }).catch(() => undefined);
  return place.next ? (
    <a href={readHref(place.next.slug, collection.slug)} onClick={finish}>
      Next in {collection.name}: {place.next.title}
    </a>
  ) : (
    <a href={`/collections/${collection.slug}`} onClick={finish}>
      You have reached the end of {collection.name}: back to the collection
    </a>
  );
}

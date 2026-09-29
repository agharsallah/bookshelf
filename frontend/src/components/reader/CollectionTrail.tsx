/**
 * Reading inside a collection (`?collection=<slug>` on the reader): a thin trail above the
 * text naming the collection and where this document sits in it, with the documents before
 * and after; and, at the end of the last chapter, the next document in place of "Back to
 * the document". Without a collection the reader shows neither.
 */
import { placeIn, readHref, type PathMember } from '../collections/path';
import styles from './CollectionTrail.module.css';

export interface ReaderCollection {
  slug: string;
  name: string;
  /** In reading order; the document being read is one of them. */
  members: PathMember[];
}

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

/** The end-of-document link: the next member to read, or back to the collection. */
export function NextInCollection({ collection, documentId }: CollectionTrailProps) {
  const place = placeIn(collection.members, documentId);
  if (!place) return null;
  return place.next ? (
    <a href={readHref(place.next.slug, collection.slug)}>
      Next in {collection.name}: {place.next.title}
    </a>
  ) : (
    <a href={`/collections/${collection.slug}`}>You have reached the end of {collection.name}: back to the collection</a>
  );
}

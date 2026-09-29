/**
 * Collections (backend/app/schemas/collections.py): hand-gathered groups of books, papers
 * and articles around one topic, addressed by id or slug, with members in reading order.
 */
import type { DocumentSummary } from './documents';

export interface CollectionPublic {
  id: string;
  /** Set once from the first name; kept on rename so links survive. */
  slug: string;
  name: string;
  description: string | null;
  /** A dye name (`DYES` in components/library/facets). */
  colour: string | null;
  /** Members in reading order. */
  document_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface CollectionMemberPublic {
  document_id: string;
  position: number;
  note: string | null;
  added_at: string;
}

export interface CollectionMemberDetail extends CollectionMemberPublic {
  document: DocumentSummary;
}

export interface CollectionDetail extends CollectionPublic {
  members: CollectionMemberDetail[];
}

export interface CollectionCreate {
  name: string;
  description?: string | null;
  colour?: string | null;
  document_ids?: string[];
}

/** Only the fields sent change; `null` clears `description` or `colour`. */
export type CollectionUpdate = Partial<Pick<CollectionPublic, 'name' | 'description' | 'colour'>>;

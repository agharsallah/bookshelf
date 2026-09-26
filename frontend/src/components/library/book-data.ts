/**
 * A book's `data-*` attributes: what the browser needs to filter and re-order the
 * server-rendered shelf and list without asking the server again. Written by the
 * server (`bookAttributes`), read back in the browser (`bookFromData`).
 */
import type { DocumentSummary } from '../../lib/api/types/documents';
import type { Filterable } from './filters';
import type { SortKeys } from './sort';

export interface ShelfBook {
  book: Filterable;
  keys: SortKeys;
}

export function bookAttributes(doc: DocumentSummary, keys: SortKeys): Record<string, string> {
  return {
    'data-book': doc.slug,
    'data-title': doc.title,
    'data-authors': JSON.stringify(doc.authors),
    'data-tags': JSON.stringify(doc.tags),
    'data-status': doc.status,
    'data-title-key': keys.title,
    'data-author-key': keys.author,
    'data-added': keys.added,
    'data-read': keys.read,
  };
}

function list(json: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function bookFromData(data: DOMStringMap): ShelfBook {
  return {
    book: { title: data.title ?? '', authors: list(data.authors), tags: list(data.tags), status: data.status ?? '' },
    keys: { title: data.titleKey ?? '', author: data.authorKey ?? '', added: data.added ?? '', read: data.read ?? '' },
  };
}

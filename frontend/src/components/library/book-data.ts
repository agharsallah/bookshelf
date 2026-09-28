/**
 * A book's `data-*` attributes: what the browser needs to filter, re-order and group
 * the server-rendered shelf and list without asking the server again. Written by the
 * server (`bookAttributes`), read back in the browser (`bookFromData`).
 */
import type { DocumentSummary } from '../../lib/api/types/documents';
import type { Buckets } from './facets';
import type { Filterable } from './filters';
import type { SortKeys } from './sort';

export interface ShelfBook {
  book: Filterable;
  keys: SortKeys;
}

export function bookAttributes(doc: DocumentSummary, buckets: Buckets, keys: SortKeys): Record<string, string> {
  return {
    'data-book': doc.slug,
    'data-title': doc.title,
    'data-authors': JSON.stringify(doc.authors),
    'data-tags': JSON.stringify(doc.tags),
    'data-status': doc.status,
    'data-genre': buckets.kind,
    'data-reading': buckets.reading,
    'data-study': buckets.study,
    'data-theme': buckets.theme,
    'data-title-key': keys.title,
    'data-author-key': keys.author,
    'data-added': keys.added,
    'data-read': keys.read,
    'data-progress': String(keys.progress),
    'data-length': String(keys.length),
    'data-year': String(keys.year),
    'data-study-count': String(keys.study),
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

function number(text: string | undefined, fallback = 0): number {
  const value = Number(text);
  return text !== undefined && text !== '' && Number.isFinite(value) ? value : fallback;
}

export function bookFromData(data: DOMStringMap): ShelfBook {
  return {
    book: {
      title: data.title ?? '',
      authors: list(data.authors),
      tags: list(data.tags),
      status: data.status ?? '',
      genre: data.genre ?? '',
      reading: data.reading ?? '',
      study: data.study ?? '',
      theme: data.theme ?? '',
    },
    keys: {
      title: data.titleKey ?? '',
      author: data.authorKey ?? '',
      added: data.added ?? '',
      read: data.read ?? '',
      progress: number(data.progress, -1),
      length: number(data.length),
      year: number(data.year),
      study: number(data.studyCount),
    },
  };
}

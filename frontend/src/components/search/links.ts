/**
 * Where things live in the app, for search, graph and concept surfaces. The reader's
 * scheme is `/documents/<slug>/read/<anchor>`: it opens the chapter that contains the
 * anchor (anchors keep their `/` separators as path segments).
 */

export function documentHref(slug: string): string {
  return `/documents/${encodeURIComponent(slug)}`;
}

/** Reader deep link; the document page when there is no anchor. */
export function readerHref(slug: string, anchor?: string | null): string {
  if (!anchor) return documentHref(slug);
  const path = anchor
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${documentHref(slug)}/read/${path}`;
}

export function conceptHref(id: string): string {
  return `/concepts/${encodeURIComponent(id)}`;
}
